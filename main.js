'use strict'
var obsidian = require('obsidian')
const { TFile } = require('obsidian');

const MARKER_PLUGIN_IS_ON = '%% Master ToDo List %%'
const PREFIXES_OPEN = ['- [ ]', '* [ ]']
const PREFIXES_COMPLETED = ['- [x]', '- [X]', '* [x]', '* [X]']
const HEADER_OPEN = '### Open'
const HEADER_COMPLETE = '### Completed'
const IMPORTED_TASK_MARKER = / %% ToDoListSource: [^\r\n]* %%\r?$/
const IMPORT_TASK_TAGS = ['#dashboard']
const IMPORT_SECTION_START = '<!-- Master ToDo List imports:start -->'
const IMPORT_SECTION_END = '<!-- Master ToDo List imports:end -->'

class ToDoList extends obsidian.Plugin {
    importedTaskText(task) {
        return task.text.trim()
            .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]/, task.status === ' ' ? '- [ ]' : '- [x]')
            .replace(/\s+\^[A-Za-z0-9-]+$/, '');
    }

    taskTrackingKey(line) {
        return line.trim().replace(/^[-*]\s+\[[ xX]\]/, '- [ ]');
    }

    removeTrackedImports(lines, previousImports) {
        const removed = new Set();
        const remaining = [];
        for (const imported of previousImports) {
            const position = lines.findIndex((line, index) =>
                !removed.has(index) && line.trim() === imported.trim());
            if (position === -1) {
                remaining.push(imported);
            } else {
                removed.add(position);
            }
        }
        for (const imported of remaining) {
            const key = this.taskTrackingKey(imported);
            const position = lines.findIndex((line, index) =>
                !removed.has(index) && this.taskTrackingKey(line) === key);
            if (position !== -1) {
                removed.add(position);
            }
        }
        return lines.filter((line, index) => !removed.has(index));
    }

    checkPluginActive(content) {
        return content.includes(MARKER_PLUGIN_IS_ON);
    }

    checkPluginStructure(content) {
        return content.includes(HEADER_OPEN) && content.includes(HEADER_COMPLETE)
    }

    // custom sorting algorithm based on priority emojis in the task lines
    sortByPriority(todoList) {
        const priorityList = {'🔺': 1, '⏫': 2, '🔼': 3, '🔽': 4, '⏬':5}

        const getPriority = (line) => {
            for (const [emoji, prioirty] of Object.entries(priorityList)) {
                if (line.includes(emoji)) {
                    return prioirty;
                }
            }
            return 6;
        }

        return todoList.sort((a, b) => getPriority(a) - getPriority(b));
    }

    // custom feature to pull todos from other sources to be added to this files
    async indexTodos(file, cache, content) {
        if (content === undefined) {
            content = await this.app.vault.cachedRead(file);
        }

        if (this.checkPluginActive(content)) {
            this.dashboardPaths.add(file.path);
            this.todoIndex.delete(file.path);
            return;
        }

        this.dashboardPaths.delete(file.path);
        const lines = content.split('\n');
        const tasks = [];

        for (const item of cache?.listItems ?? []) {
            if (![' ', 'x', 'X'].includes(item.task)) {
                continue;
            }

            const text = lines[item.position.start.line];
            if (text === undefined || IMPORTED_TASK_MARKER.test(text)) {
                continue;
            }

            const words = text.trim().split(/\s+/);
            if (!IMPORT_TASK_TAGS.some(tag => words.includes(tag))) {
                continue;
            }

            tasks.push({
                sourcePath: file.path,
                line: item.position.start.line,
                text,
                status: item.task,
                blockId: text.match(/\^([A-Za-z0-9-]+)\s*$/)?.[1] ?? null
            });
        }

        this.todoIndex.set(file.path, tasks);
    }

    getAllTodos(){
        return Array.from(this.todoIndex.values()).flat();
    }


    recreatePluginStructure(content, importedTodos = [], previousImports = []) {
        const lines = this.removeTrackedImports(content.split('\n'), previousImports);

        const otherLines = [];
        const openTodo = [];
        const completedTodo = [];
        let insideImports = false;
        
        outerLoop: for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === IMPORT_SECTION_START || trimmed === LEGACY_IMPORT_SECTION_START) {
                if (insideImports) {
                    throw new Error('ToDoList: Nested import sections; note left unchanged.');
                }
                insideImports = true;
                continue;
            }
            if (trimmed === IMPORT_SECTION_END || trimmed === LEGACY_IMPORT_SECTION_END) {
                if (!insideImports) {
                    throw new Error('ToDoList: Unmatched import section end; note left unchanged.');
                }
                insideImports = false;
                continue;
            }
            if (insideImports) {
                continue;
            }
            if (IMPORTED_TASK_MARKER.test(line)) {
                continue;
            }

            for (const prefix of PREFIXES_OPEN) {
                if (trimmed.startsWith(prefix)) {
                    openTodo.push(line);
                    continue outerLoop;
                }
            }

            for (const prefix of PREFIXES_COMPLETED) {
                if (trimmed.startsWith(prefix)) {
                    completedTodo.push(line);
                    continue outerLoop;
                }
            }
            
            if (trimmed != '' && trimmed != HEADER_OPEN && trimmed != HEADER_COMPLETE) {
                otherLines.push(line);
            }
            
        }

        if (insideImports) {
            throw new Error('ToDoList: Missing import section end; note left unchanged.');
        }

        for (const task of importedTodos) {
            const text = this.importedTaskText(task);
            if (task.status === ' ') {
                openTodo.push(text);
            } else {
                completedTodo.push(text);
            }
        }

        const newLines = []

        newLines.push(...otherLines);

        newLines.push('');
        newLines.push(HEADER_OPEN);
        newLines.push(...this.sortByPriority(openTodo));

        newLines.push('');
        newLines.push(HEADER_COMPLETE);
        newLines.push(...this.sortByPriority(completedTodo));

        return newLines.join('\n');
    }

    async scanTodos() {
        this.todoIndex.clear();
        this.dashboardPaths.clear();
        for (const file of this.app.vault.getMarkdownFiles()) {
            await this.indexTodos(
                file,
                this.app.metadataCache.getFileCache(file)
            )
        }
    }

    queueUpdate(update) {
        this.updateQueue = this.updateQueue.then(update).catch(console.error);
    }

    async refreshDashboards() {
        const tasks = this.getAllTodos();
        const nextImports = tasks.map(task => this.importedTaskText(task));
        for (const path of this.dashboardPaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                continue;
            }

            const content = await this.app.vault.read(file);
            const previousImports = this.importTracking.get(path) ?? [];
            if (!this.checkPluginActive(content) ||
                content === this.recreatePluginStructure(content, tasks, previousImports)) {
                continue;
            }

            let updated = false;
            await this.app.vault.process(file, (latest) => {
                if (!this.checkPluginActive(latest)) {
                    return latest;
                }
                updated = true;
                return this.recreatePluginStructure(latest, tasks, previousImports);
            });
            if (updated) {
                this.importTracking.set(path, nextImports);
                await this.saveImportTracking();
            }
        }
    }

    async saveImportTracking() {
        this.pluginData.importedTaskLines = Object.fromEntries(this.importTracking);
        await this.saveData(this.pluginData);
    }

    async rewriteFile(file, newContent) {
        try {
            await this.app.vault.modify(file, newContent);
        } catch (error) {
            console.log(`ToDoList: error "${error}" while overwriting file "${file.name}".`);
            return;
        }
        
        console.log(`ToDoList: file "${file.name}" updated.`);
    }

    async onload() {
        console.log('ToDoList plugin is on!')
        this.todoIndex = new Map();
        this.dashboardPaths = new Set();
        this.updateQueue = Promise.resolve();
        this.pluginData = await this.loadData() ?? {};
        this.importTracking = new Map(Object.entries(this.pluginData.importedTaskLines ?? {})
            .filter(([path, lines]) => Array.isArray(lines) && lines.every(line => typeof line === 'string')));

        this.registerEvent(
            this.app.metadataCache.on('changed', (file, content, cache) => {
                this.queueUpdate(async () => {
                    await this.indexTodos(file, cache, content);
                    await this.refreshDashboards();
                });
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                this.queueUpdate(async () => {
                    for (const path of this.importTracking.keys()) {
                        if (path === file.path || path.startsWith(file.path + '/')) {
                            this.importTracking.delete(path);
                        }
                    }
                    await this.saveImportTracking();
                    await this.scanTodos();
                    await this.refreshDashboards();
                });
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                this.queueUpdate(async () => {
                    for (const [path, lines] of Array.from(this.importTracking)) {
                        if (path === oldPath || path.startsWith(oldPath + '/')) {
                            this.importTracking.delete(path);
                            this.importTracking.set(file.path + path.slice(oldPath.length), lines);
                        }
                    }
                    await this.saveImportTracking();
                    await this.scanTodos();
                    await this.refreshDashboards();
                });
            })
        );

        this.app.workspace.onLayoutReady(() => {
            this.queueUpdate(async () => {
                await this.scanTodos();
                await this.refreshDashboards();
            });
        });

    }
}

module.exports = ToDoList
/* nosourcemap */
