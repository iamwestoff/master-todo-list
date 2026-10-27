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
        const metadata = [];
        const text = line.trim().replace(/^[-*]\s+\[[ xX]\]/, '- [ ]')
            .replace(/\s+\u2705\s+\d{4}-\d{2}-\d{2}(?=\s|$)/g, '')
            .replace(/(^|\s)(#dashboard|\u{1f53a}|\u23eb|\u{1f53c}|\u{1f53d}|\u23ec)(?=\s|$)/gu,
                (match, spacing, token) => {
                    metadata.push(token);
                    return spacing;
                })
            .replace(/\s+/g, ' ').trim();
        return JSON.stringify([text, metadata.sort()]);
    }

    importedTaskLine(task) {
        return this.importedTaskText(task);
    }

    async syncDashboardTasks(path, content) {
        const tracked = this.importSources.get(path) ?? (this.importTracking.get(path) ?? []).flatMap(text => {
            const marker = text.match(IMPORTED_TASK_MARKER)?.[0].trim();
            if (!marker) return [];
            try {
                return [{ text, source: JSON.parse(decodeURIComponent(marker.slice('%% ToDoListSource: '.length, -3))) }];
            } catch {
                return [];
            }
        });
        const lines = content.split('\n');
        const used = new Set();
        const changed = [];
        for (const record of tracked) {
            const key = this.taskTrackingKey(record.text);
            const completedCopies = lines.flatMap((line, index) =>
                /^\s*[-*]\s+\[[xX]\]/.test(line) && /\u2705\s+\d{4}-\d{2}-\d{2}/.test(line) &&
                this.taskTrackingKey(line) === key ? [index] : []);
            if (/^[-*]\s+\[ \]/.test(record.text.trim()) && completedCopies.length > 0 &&
                new Set(completedCopies.map(index => lines[index].match(/\u2705\s+\d{4}-\d{2}-\d{2}/)[0])).size === 1 &&
                tracked.filter(candidate => this.taskTrackingKey(candidate.text) === key).length === 1 &&
                lines.some(line => line.trim() === record.text.trim())) {
                const position = completedCopies[0];
                for (const index of completedCopies) used.add(index);
                changed.push({ ...record, currentLine: position, recoverDuplicate: completedCopies.map(index => lines[index]) });
                continue;
            }
            const position = record.dashboardLine;
            if (Number.isInteger(position) && lines[position] !== undefined && !used.has(position) &&
                this.taskTrackingKey(lines[position]) === this.taskTrackingKey(record.text)) {
                used.add(position);
                if (lines[position].trim() !== record.text.trim()) changed.push({ ...record, currentLine: position });
                continue;
            }
            const exact = lines.findIndex((line, index) => !used.has(index) && line.trim() === record.text.trim());
            if (exact !== -1) used.add(exact);
            else changed.push(record);
        }
        for (const record of changed) {
            const matches = lines.map((line, index) => ({ line, index })).filter(({ line, index }) =>
                !used.has(index) && this.taskTrackingKey(line) === this.taskTrackingKey(record.text));
            const match = Number.isInteger(record.currentLine)
                ? { line: lines[record.currentLine], index: record.currentLine }
                : matches.find(candidate => candidate.index === record.dashboardLine) ??
                    (matches.length === 1 ? matches[0] : undefined);
            if (!match) continue;
            used.add(match.index);
            const status = match.line.trim().match(/^[-*]\s+\[([ xX])\]/)?.[1];
            const previousStatus = record.text.trim().match(/^[-*]\s+\[([ xX])\]/)?.[1];
            const completionDateChanged = match.line.match(/\u2705\s+\d{4}-\d{2}-\d{2}/)?.[0] !==
                record.text.match(/\u2705\s+\d{4}-\d{2}-\d{2}/)?.[0];
            if (status === undefined || previousStatus === undefined ||
                ((status === ' ') === (previousStatus === ' ') && !completionDateChanged)) continue;
            const source = record.source;
            if (!source || typeof source.path !== 'string' || typeof source.text !== 'string') {
                continue;
            }
            const file = this.app.vault.getAbstractFileByPath(source.path);
            if (!(file instanceof TFile) || file.path === path) {
                continue;
            }

            const dashboardText = match.line;
            let synchronized = false;
            await this.app.vault.process(file, latest => {
                if (this.checkPluginActive(latest)) {
                    return latest;
                }
                const lines = latest.split('\n');
                const matches = lines.map((text, index) => ({ text, index }))
                    .filter(({ text }) => /^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/.test(text) &&
                        (source.blockId
                            ? text.trim().endsWith(` ^${source.blockId}`)
                            : this.taskTrackingKey(this.importedTaskText({ text, status: ' ' })) === this.taskTrackingKey(source.text)));
                const match = source.blockId
                    ? (matches.length === 1 ? matches[0] : undefined)
                    : matches.find(candidate => candidate.index === source.line) ??
                        (matches.length === 1 ? matches[0] : undefined);
                if (!match) {
                    return latest;
                }
                const nextStatus = status === ' ' ? ' ' : 'x';
                lines[match.index] = match.text.replace(/^(\s*(?:[-*]|\d+[.)])\s+\[)[ xX](\])/, `$1${nextStatus}$2`);
                const completionDate = nextStatus === 'x'
                    ? dashboardText.match(/\u2705\s+\d{4}-\d{2}-\d{2}(?=\s|$)/)?.[0] : undefined;
                if (nextStatus === ' ' || completionDate) {
                    lines[match.index] = lines[match.index].replace(/\s+\u2705\s+\d{4}-\d{2}-\d{2}(?=\s|$)/g, '');
                }
                if (completionDate) {
                    lines[match.index] = lines[match.index].replace(/(\s+\^[A-Za-z0-9-]+)?(\r?)$/,
                        (suffix, blockId = '', ending = '') => ` ${completionDate}${blockId}${ending}`);
                }
                const indexed = this.todoIndex.get(file.path)?.find(task =>
                    task.line === source.line &&
                    this.taskTrackingKey(this.importedTaskText({ ...task, status: ' ' })) === this.taskTrackingKey(source.text));
                if (indexed) {
                    indexed.status = nextStatus;
                    indexed.text = lines[match.index];
                    indexed.line = match.index;
                }
                synchronized = true;
                return lines.join('\n');
            });
            if (synchronized && record.recoverDuplicate) {
                const previous = this.importTracking.get(path) ?? [];
                this.importTracking.set(path, [...previous, ...record.recoverDuplicate]);
            }
        }
    }

    trackDashboardImports(path, content, tasks) {
        const lines = content.split('\n');
        const used = new Set();
        const records = [];
        for (const task of [...tasks].reverse()) {
            const text = this.importedTaskText(task);
            for (let index = lines.length - 1; index >= 0; index--) {
                if (used.has(index) || lines[index].trim() !== text) continue;
                used.add(index);
                records.push({ dashboardLine: index, text, source: {
                    path: task.sourcePath,
                    line: task.line,
                    blockId: task.blockId,
                    text: this.importedTaskText({ ...task, status: ' ' })
                } });
                break;
            }
        }
        this.importSources.set(path, records.reverse());
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
            if (trimmed === IMPORT_SECTION_START) {
                if (insideImports) {
                    throw new Error('ToDoList: Nested import sections; note left unchanged.');
                }
                insideImports = true;
                continue;
            }
            if (trimmed === IMPORT_SECTION_END) {
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
            const text = this.importedTaskLine(task);
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
        for (const path of this.dashboardPaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;
            const latest = await this.app.vault.read(file);
            if (this.checkPluginActive(latest)) await this.syncDashboardTasks(path, latest);
        }
        const tasks = this.getAllTodos();
        const nextImports = tasks.map(task => this.importedTaskLine(task));
        for (const path of this.dashboardPaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                continue;
            }

            const content = await this.app.vault.read(file);
            const previousImports = this.importTracking.get(path) ?? [];
            if (!this.checkPluginActive(content)) {
                continue;
            }

            const before = JSON.stringify(this.importSources.get(path));
            let result = content;
            if (content !== this.recreatePluginStructure(content, tasks, previousImports)) {
                await this.app.vault.process(file, latest => {
                    result = this.checkPluginActive(latest)
                        ? this.recreatePluginStructure(latest, tasks, previousImports) : latest;
                    return result;
                });
            }
            if (this.checkPluginActive(result)) {
                this.trackDashboardImports(path, result, tasks);
                this.importTracking.set(path, nextImports);
                if (before !== JSON.stringify(this.importSources.get(path)) ||
                    JSON.stringify(previousImports) !== JSON.stringify(nextImports)) {
                    await this.saveImportTracking();
                }
            }
        }
    }

    async saveImportTracking() {
        this.pluginData.importedTaskLines = Object.fromEntries(this.importTracking);
        this.pluginData.importedTaskSources = Object.fromEntries(this.importSources);
        await this.saveData(this.pluginData);
    }

    getTaskSource(path, lineNumber, content) {
        const lines = content.split('\n');
        const text = lines[lineNumber] ?? '';
        if (!/^\s*[-*]\s+\[[ xX]\]/.test(text) || !text.trim().split(/\s+/).includes('#dashboard')) {
            return null;
        }
        const key = this.taskTrackingKey(text);
        const matches = (this.importSources.get(path) ?? [])
            .filter(record => this.taskTrackingKey(record.text) === key);
        const positioned = matches.find(record => record.dashboardLine === lineNumber);
        if (positioned) return positioned.source;
        if (matches.length === 1 && lines.filter(line => this.taskTrackingKey(line) === key).length === 1) {
            return matches[0].source;
        }
        return null;
    }

    async openOriginalTask(source) {
        const file = this.app.vault.getAbstractFileByPath(source.path);
        if (!(file instanceof TFile)) {
            new obsidian.Notice('The original task note could not be found.');
            return;
        }
        const lines = (await this.app.vault.read(file)).split('\n');
        const matches = lines.flatMap((text, index) => {
            if (!/^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/.test(text)) return [];
            const matched = source.blockId
                ? text.trim().endsWith(` ^${source.blockId}`)
                : this.taskTrackingKey(this.importedTaskText({ text, status: ' ' })) === this.taskTrackingKey(source.text);
            return matched ? [index] : [];
        });
        const line = source.blockId
            ? (matches.length === 1 ? matches[0] : undefined)
            : matches.find(index => index === source.line) ?? (matches.length === 1 ? matches[0] : undefined);
        if (line === undefined) {
            new obsidian.Notice('The original task could not be located safely.');
            return;
        }
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file, { active: true, state: { mode: 'source' }, eState: { line } });
        const editor = leaf.view?.editor;
        if (editor) {
            const from = { line, ch: 0 };
            const to = { line, ch: lines[line].replace(/\r$/, '').length };
            editor.setSelection(from, to);
            editor.scrollIntoView({ from, to }, true);
        }
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
        this.importSources = new Map(Object.entries(this.pluginData.importedTaskSources ?? {})
            .filter(([path, records]) => Array.isArray(records) && records.every(record =>
                record && typeof record.text === 'string' && record.source)));

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (!view.file) return;
                const source = this.getTaskSource(view.file.path, editor.getCursor().line, editor.getValue());
                if (!source) return;
                menu.addItem(item => item.setTitle('Go to original task').setIcon('file-input')
                    .onClick(() => this.openOriginalTask(source)));
            })
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', (file, content, cache) => {
                this.queueUpdate(async () => {
                    await this.indexTodos(file, cache, content);
                    await this.refreshDashboards();
                });
            })
        );

        this.registerEvent(
            this.app.vault.on('modify', file => {
                if (file instanceof TFile && this.dashboardPaths.has(file.path)) {
                    this.queueUpdate(() => this.refreshDashboards());
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                this.queueUpdate(async () => {
                    for (const path of this.importTracking.keys()) {
                        if (path === file.path || path.startsWith(file.path + '/')) {
                            this.importTracking.delete(path);
                            this.importSources.delete(path);
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
                            const sources = this.importSources.get(path);
                            this.importSources.delete(path);
                            if (sources) this.importSources.set(file.path + path.slice(oldPath.length), sources);
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
