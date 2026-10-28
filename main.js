'use strict';
const obsidian = require('obsidian');
const { TFile } = obsidian;

const MARKER_PLUGIN_IS_ON = '%% Master ToDo List %%';
const PREFIXES_OPEN = ['- [ ]', '* [ ]'];
const PREFIXES_COMPLETED = ['- [x]', '- [X]', '* [x]', '* [X]'];
const HEADER_OPEN = '### Open';
const HEADER_COMPLETE = '### Completed';
const IMPORTED_TASK_MARKER = / %% ToDoListSource: [^\r\n]* %%\r?$/;
const DEFAULT_SETTINGS = { importTag: '#task' };
const IMPORT_SECTION_START = '<!-- Master ToDo List imports:start -->';
const IMPORT_SECTION_END = '<!-- Master ToDo List imports:end -->';
const PRIORITY_MARKERS = ['\u{1f53a}', '\u23eb', '\u{1f53c}', '\u{1f53d}', '\u23ec'];

class ToDoList extends obsidian.Plugin {
    normalizeImportTag(value) {
        if (typeof value !== 'string') return null;
        const tag = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
        return /^#[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag) && /[\p{L}_-]/u.test(tag) ? tag : null;
    }

    hasImportTag(text) {
        return text.trim().split(/\s+/).includes(this.settings.importTag);
    }

    async updateImportTag(value) {
        const tag = this.normalizeImportTag(value);
        if (!tag) {
            new obsidian.Notice('Enter one valid task tag, such as #task or #work/tasks.');
            return false;
        }
        if (tag === this.settings.importTag) return true;
        this.queueUpdate(async () => {
            await this.refreshDashboards();
            this.settings.importTag = tag;
            await this.saveImportTracking();
            await this.scanTodos();
            await this.refreshDashboards();
        });
        await this.updateQueue;
        return true;
    }

    projectForPath(path) {
        const file = this.app.vault.getAbstractFileByPath(path);
        const project = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter?.project : null;
        if (typeof project === 'string' && project.trim()) {
            return project.trim().replace(/[\r\n]+/g, ' ');
        }
        return path.split('/').slice(-2, -1)[0] || 'Unassigned';
    }

    projectTaskLines(tasks) {
        const projects = new Map();
        for (const task of tasks) {
            if (!projects.has(task.project)) projects.set(task.project, []);
            projects.get(task.project).push(task.text);
        }
        const lines = [];
        for (const project of Array.from(projects.keys()).sort((first, second) => first.localeCompare(second))) {
            if (lines.length) lines.push('');
            lines.push(`#### ${project}`, ...this.sortByPriority(projects.get(project)));
        }
        return lines;
    }

    importedTaskText(task) {
        return task.text.trim()
            .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]/, task.status === ' ' ? '- [ ]' : '- [x]')
            .replace(/\s+\^[A-Za-z0-9-]+$/, '');
    }

    taskTrackingKey(line) {
        const metadata = [];
        const text = line.trim().replace(/^[-*]\s+\[[ xX]\]/, '- [ ]')
            .replace(/\s+\u2705\s+\d{4}-\d{2}-\d{2}(?=\s|$)/g, '')
            .replace(/(^|\s)(#[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*|\u{1f53a}|\u23eb|\u{1f53c}|\u{1f53d}|\u23ec)(?=\s|$)/gu,
                (match, spacing, token) => {
                    metadata.push(token);
                    return spacing;
                })
            .replace(/\s+/g, ' ').trim();
        return JSON.stringify([text, metadata.sort()]);
    }

    importedTaskLine(task) {
        return task.blockLines?.join('\n') ?? this.importedTaskText(task);
    }

    lineIndent(line) {
        return (line.match(/^[\t ]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
    }

    taskBlockEnd(lines, start) {
        const indent = this.lineIndent(lines[start]);
        let end = start + 1;
        for (let index = start + 1; index < lines.length; index++) {
            if (!lines[index].trim()) continue;
            if (this.lineIndent(lines[index]) <= indent) break;
            end = index + 1;
        }
        return end;
    }

    sourceTask(path, lines, index) {
        return {
            sourcePath: path,
            line: index,
            text: lines[index],
            status: lines[index].match(/^\s*(?:[-*]|\d+[.)])\s+\[([ xX])\]/)[1],
            blockId: lines[index].match(/\^([A-Za-z0-9-]+)\s*$/)?.[1] ?? null
        };
    }

    findSourceTaskLine(lines, source, requireUniqueBlockId = true) {
        const key = this.taskTrackingKey(this.importedTaskText({ text: source.text, status: ' ' }));
        const matches = lines.flatMap((text, index) => {
            if (!/^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/.test(text)) return [];
            const matched = source.blockId
                ? text.trim().endsWith(` ^${source.blockId}`)
                : this.taskTrackingKey(this.importedTaskText({ text, status: ' ' })) === key;
            return matched ? [index] : [];
        });
        if (source.blockId && requireUniqueBlockId) {
            return matches.length === 1 ? matches[0] : undefined;
        }
        return matches.find(index => index === source.line) ?? (matches.length === 1 ? matches[0] : undefined);
    }

    async reindexSource(file, content, newRootLines = []) {
        const lines = content.split('\n');
        const positions = new Set(newRootLines);
        for (const task of this.todoIndex.get(file.path) ?? []) {
            const position = this.findSourceTaskLine(lines, task, false);
            if (position !== undefined) positions.add(position);
        }
        await this.indexTodos(file, { listItems: Array.from(positions).sort((first, second) => first - second)
            .map(line => ({ task: lines[line].match(/\[([ xX])\]/)[1], position: { start: { line } } })) }, content);
    }

    nestedLineKey(line) {
        const text = line.replace(/\s+\^[A-Za-z0-9-]+\s*$/, '');
        return `${this.lineIndent(line)}:${/^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/.test(text)
            ? this.taskTrackingKey(this.importedTaskText({ text, status: ' ' })) : text.trim()}`;
    }

    nestedLineType(line) {
        const list = line.trimStart().match(/^(?:[-*]|\d+[.)])\s+(\[[ xX]\])?/);
        return `${this.lineIndent(line)}:${list ? (list[1] ? 'task' : 'list') : 'text'}`;
    }

    editedNestedSourceLine(original, updated) {
        const blockId = original.match(/\s+\^[A-Za-z0-9-]+\s*$/)?.[0] ?? '';
        const text = updated.trimStart().replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').replace(/\r$/, '');
        const checkbox = original.match(/^(\s*(?:[-*]|\d+[.)])\s+\[)[ xX](\]\s*)/);
        if (checkbox) {
            const task = text.match(/^(?:[-*]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/);
            return `${checkbox[1]}${task[1]}${checkbox[2]}${task[2]}${blockId}`;
        }
        return (original.match(/^[\t ]*/)?.[0] ?? '') + text + blockId;
    }

    nestedChanges(current, baseline) {
        const addedLines = [];
        const editedLines = new Set();
        const currentKeys = current.map(text => this.nestedLineKey(text));
        const baselineKeys = baseline.map(text => this.nestedLineKey(text));
        let previous = 1;
        const mapping = [0];
        for (let index = 1; index < current.length; index++) {
            const nextMatch = baselineKeys.indexOf(currentKeys[index], previous);
            if (nextMatch !== -1) {
                mapping.push(nextMatch);
                previous = nextMatch + 1;
            } else if (current.length === baseline.length && previous < baseline.length &&
                this.nestedLineType(current[index]) === this.nestedLineType(baseline[previous]) &&
                !currentKeys.slice(index + 1).includes(baselineKeys[previous]) &&
                !baselineKeys.slice(previous + 1).includes(currentKeys[index])) {
                mapping.push(previous++);
                editedLines.add(index);
            } else {
                if (baselineKeys.slice(1, previous).includes(currentKeys[index])) return null;
                mapping.push(null);
                addedLines.push(current[index]);
            }
        }
        const deletedLines = baselineKeys.flatMap((key, index) => index > 0 && !mapping.includes(index) ? [index] : []);
        if (deletedLines.some(index => baselineKeys.indexOf(baselineKeys[index]) !== baselineKeys.lastIndexOf(baselineKeys[index]))) {
            return null;
        }
        const incomplete = text => /^\s*(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?$/.test(text);
        const pendingLines = new Set(current.flatMap((text, index) =>
            (mapping[index] === null || editedLines.has(index)) && incomplete(text) ? [index] : []));
        if (pendingLines.size) {
            for (const index of pendingLines) editedLines.delete(index);
            addedLines.splice(0, addedLines.length, ...addedLines.filter(text => !incomplete(text)));
        }
        return { mapping, baselineKeys, addedLines, editedLines, deletedLines, pendingLines };
    }

    sourceBaselineMapping(normalized, baselineKeys) {
        const sourceKeys = normalized.map(text => this.nestedLineKey(text));
        const mapping = new Map();
        let searchFrom = 0;
        if (sourceKeys[0] !== baselineKeys[0]) return null;
        for (let index = 0; index < sourceKeys.length; index++) {
            const match = baselineKeys.indexOf(sourceKeys[index], searchFrom);
            if (match === -1) return null;
            mapping.set(match, index);
            searchFrom = match + 1;
        }
        const unchanged = sourceKeys.length === baselineKeys.length;
        const onlyDeleted = sourceKeys.length < baselineKeys.length && new Set(baselineKeys).size === baselineKeys.length;
        return unchanged || onlyDeleted ? mapping : null;
    }

    async syncNewDashboardItems(path, content) {
        const records = this.importSources.get(path) ?? [];
        const roots = records.filter(record => Array.isArray(record.blockLines));
        const lines = content.split('\n');
        let editing = false;
        let project = null;
        const projects = lines.map(line => {
            if (line.startsWith('#### ')) project = line.slice(5);
            if (line === HEADER_OPEN || line === HEADER_COMPLETE) project = null;
            return project;
        });
        for (const record of roots) {
            const expectedProject = this.projectForPath(record.source.path);
            const candidates = lines.flatMap((line, index) => projects[index] === expectedProject &&
                this.taskTrackingKey(line) === this.taskTrackingKey(record.text) ? [index] : []);
            const start = candidates.find(index => index === record.dashboardLine) ??
                (candidates.length === 1 ? candidates[0] : undefined);
            if (start === undefined) continue;
            const end = this.taskBlockEnd(lines, start);
            const current = lines.slice(start, end);
            const baseline = record.blockLines;
            const changes = this.nestedChanges(current, baseline);
            if (!changes) return false;
            const { mapping, baselineKeys, addedLines, editedLines, deletedLines, pendingLines } = changes;
            if (pendingLines.size) editing = true;
            const siblings = [];
            const sourcePaths = new Set(roots.filter(item => this.projectForPath(item.source.path) === expectedProject)
                .map(item => item.source.path));
            if (expectedProject !== this.projectForPath(path)) {
                let cursor = end;
                while (cursor < lines.length) {
                    if (!lines[cursor].trim()) { cursor++; continue; }
                    if (projects[cursor] !== expectedProject || this.lineIndent(lines[cursor]) !== this.lineIndent(lines[start]) ||
                        !/^\s*[-*]\s+\[[ xX]\]/.test(lines[cursor])) break;
                    if (records.some(item => this.taskTrackingKey(item.text) === this.taskTrackingKey(lines[cursor]))) break;
                    if (/^\s*[-*]\s+\[[ xX]\]\s*$/.test(lines[cursor])) {
                        editing = true;
                        break;
                    }
                    if (sourcePaths.size !== 1) return false;
                    const siblingEnd = this.taskBlockEnd(lines, cursor);
                    siblings.push(lines.slice(cursor, siblingEnd));
                    cursor = siblingEnd;
                }
            }
            if (!addedLines.length && !editedLines.size && !deletedLines.length && !siblings.length) continue;
            const file = this.app.vault.getAbstractFileByPath(record.source.path);
            if (!(file instanceof TFile)) return false;
            let written;
            let sourceVersion;
            const deletionOnly = deletedLines.length > 0 && !addedLines.length && !editedLines.size && !siblings.length;
            const newRootLines = [];
            await this.app.vault.process(file, latest => {
                if (this.checkPluginActive(latest)) return latest;
                const ending = latest.includes('\r\n') ? '\r\n' : '\n';
                const sourceLines = latest.split(/\r?\n/);
                const sourceStart = this.findSourceTaskLine(sourceLines, record.source, false);
                if (sourceStart === undefined) {
                    if (deletionOnly) sourceVersion = latest;
                    return latest;
                }
                const sourceEnd = this.taskBlockEnd(sourceLines, sourceStart);
                const original = sourceLines.slice(sourceStart, sourceEnd);
                const sourceIndent = this.lineIndent(original[0]);
                const normalized = original.map((text, index) => index === 0 ? this.importedTaskText({ text, status: ' ' })
                    : ' '.repeat(Math.max(0, this.lineIndent(text) - sourceIndent)) + text.trimStart());
                const sourceMapping = this.sourceBaselineMapping(normalized, baselineKeys);
                if (!sourceMapping) {
                    if (deletionOnly) sourceVersion = latest;
                    return latest;
                }
                const replacement = current.flatMap((text, index) => {
                    const sourceIndex = sourceMapping.get(mapping[index]);
                    if (pendingLines.has(index)) return sourceIndex === undefined ? [] : [original[sourceIndex]];
                    if (mapping[index] === null || (sourceIndex === undefined && editedLines.has(index))) {
                        return [' '.repeat(sourceIndent + this.lineIndent(text) - this.lineIndent(lines[start])) + text.trimStart().replace(/\r$/, '')];
                    }
                    if (sourceIndex === undefined) return [];
                    return [editedLines.has(index) ? this.editedNestedSourceLine(original[sourceIndex], text) : original[sourceIndex]];
                });
                for (const sibling of siblings) {
                    newRootLines.push(sourceStart + replacement.length);
                    const text = sibling[0].trim();
                    const tagged = this.hasImportTag(text) ? text : text.replace(/(\s+\^[A-Za-z0-9-]+)?$/,
                        (suffix, blockId = '') => ` ${this.settings.importTag}${blockId}`);
                    replacement.push(' '.repeat(sourceIndent) + tagged);
                    replacement.push(...sibling.slice(1).map(text =>
                        ' '.repeat(sourceIndent + this.lineIndent(text) - this.lineIndent(sibling[0])) + text.trimStart().replace(/\r$/, '')));
                }
                sourceLines.splice(sourceStart, sourceEnd - sourceStart, ...replacement);
                written = sourceLines.join(ending);
                return written;
            });
            if (written === undefined) {
                if (sourceVersion !== undefined) {
                    await this.reindexSource(file, sourceVersion);
                    new obsidian.Notice('The source task changed before the dashboard deletion could be applied. Its current source version was kept.');
                    continue;
                }
                return false;
            }
            await this.reindexSource(file, written, newRootLines);
            this.importTracking.set(path, [...(this.importTracking.get(path) ?? []), ...addedLines,
                ...Array.from(editedLines, index => current[index]), ...siblings.map(block => block.join('\n'))]);
            this.trackDashboardImports(path, content, this.getAllTodos());
            await this.saveImportTracking();
        }
        return editing ? 'editing' : true;
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
            let sourceContent;
            await this.app.vault.process(file, latest => {
                if (this.checkPluginActive(latest)) {
                    return latest;
                }
                const lines = latest.split('\n');
                const line = this.findSourceTaskLine(lines, source);
                if (line === undefined) {
                    return latest;
                }
                const nextStatus = status === ' ' ? ' ' : 'x';
                lines[line] = lines[line].replace(/^(\s*(?:[-*]|\d+[.)])\s+\[)[ xX](\])/, `$1${nextStatus}$2`);
                const completionDate = nextStatus === 'x'
                    ? dashboardText.match(/\u2705\s+\d{4}-\d{2}-\d{2}(?=\s|$)/)?.[0] : undefined;
                if (nextStatus === ' ' || completionDate) {
                    lines[line] = lines[line].replace(/\s+\u2705\s+\d{4}-\d{2}-\d{2}(?=\s|$)/g, '');
                }
                if (completionDate) {
                    lines[line] = lines[line].replace(/(\s+\^[A-Za-z0-9-]+)?(\r?)$/,
                        (suffix, blockId = '', ending = '') => ` ${completionDate}${blockId}${ending}`);
                }
                const indexed = (this.todoIndex.get(file.path) ?? []).flatMap(task => [task, ...(task.children ?? [])]).find(task =>
                    task.line === source.line &&
                    this.taskTrackingKey(this.importedTaskText({ ...task, status: ' ' })) === this.taskTrackingKey(source.text));
                if (indexed) {
                    indexed.status = nextStatus;
                    indexed.text = lines[line];
                    indexed.line = line;
                }
                synchronized = true;
                sourceContent = lines.join('\n');
                return sourceContent;
            });
            if (synchronized) await this.reindexSource(file, sourceContent);
            if (synchronized && record.recoverDuplicate) {
                const previous = this.importTracking.get(path) ?? [];
                this.importTracking.set(path, [...previous, ...record.recoverDuplicate]);
            }
        }
    }

    trackDashboardImports(path, content, tasks) {
        const lines = content.split('\n');
        let project = null;
        const projects = lines.map(line => {
            if (line.startsWith('#### ')) project = line.slice(5);
            return project;
        });
        const used = new Set();
        const records = [];
        for (const task of [...tasks].reverse()) {
            const text = this.importedTaskText(task);
            for (let index = lines.length - 1; index >= 0; index--) {
                if (used.has(index) || lines[index].trim() !== text || projects[index] !== this.projectForPath(task.sourcePath)) continue;
                used.add(index);
                let previousLine = index;
                const blockEnd = this.taskBlockEnd(lines, index);
                for (const item of [task, ...(task.children ?? [])]) {
                    const dashboardLine = item === task ? index : lines.findIndex((line, position) =>
                        position > previousLine && position < blockEnd &&
                        this.taskTrackingKey(line) === this.taskTrackingKey(this.importedTaskText(item)));
                    if (dashboardLine === -1) continue;
                    previousLine = dashboardLine;
                    used.add(dashboardLine);
                    records.push({ dashboardLine, text: lines[dashboardLine],
                        ...(item === task ? { blockLines: task.blockLines ?? [text] } : {}), source: {
                            path: item.sourcePath,
                            line: item.line,
                            blockId: item.blockId,
                            text: this.importedTaskText({ ...item, status: ' ' })
                        } });
                }
                break;
            }
        }
        this.importSources.set(path, records.sort((first, second) => first.dashboardLine - second.dashboardLine));
    }

    removeTrackedImports(lines, previousImports) {
        const removed = new Set();
        const remaining = [];
        for (const imported of previousImports.flatMap(text => text.split('\n'))) {
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

    sortByPriority(todoList) {
        const getPriority = (line) => {
            const parent = line.split('\n')[0];
            const priority = PRIORITY_MARKERS.findIndex(marker => parent.includes(marker));
            return priority === -1 ? PRIORITY_MARKERS.length : priority;
        };

        return todoList.sort((a, b) => getPriority(a) - getPriority(b));
    }

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
        let consumedUntil = -1;

        for (const item of cache?.listItems ?? []) {
            if (item.position.start.line < consumedUntil) continue;
            if (![' ', 'x', 'X'].includes(item.task)) {
                continue;
            }

            const text = lines[item.position.start.line];
            if (text === undefined || IMPORTED_TASK_MARKER.test(text)) {
                continue;
            }

            if (!this.hasImportTag(text)) {
                continue;
            }

            const start = item.position.start.line;
            const task = this.sourceTask(file.path, lines, start);
            consumedUntil = this.taskBlockEnd(lines, start);
            task.children = [];
            task.blockLines = [this.importedTaskText(task)];
            for (let index = start + 1; index < consumedUntil; index++) {
                const indent = Math.max(0, this.lineIndent(lines[index]) - this.lineIndent(text));
                if (/^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/.test(lines[index])) {
                    const child = this.sourceTask(file.path, lines, index);
                    task.children.push(child);
                    task.blockLines.push(' '.repeat(indent) + this.importedTaskText(child));
                } else {
                    task.blockLines.push(' '.repeat(indent) + lines[index].trimStart().replace(/\r$/, ''));
                }
            }
            tasks.push(task);
        }

        this.todoIndex.set(file.path, tasks);
    }

    getAllTodos() {
        return Array.from(this.todoIndex.values()).flat();
    }

    recreatePluginStructure(content, importedTodos = [], previousImports = [], dashboardPath = '') {
        const lines = this.removeTrackedImports(content.split('\n'), previousImports);
        const localProject = this.projectForPath(dashboardPath);
        const projectHeadings = new Set([
            ...(this.projectHeadings.get(dashboardPath) ?? []),
            `#### ${localProject}`,
            ...importedTodos.map(task => `#### ${this.projectForPath(task.sourcePath)}`)
        ]);

        const otherLines = [];
        const openTodo = [];
        const completedTodo = [];
        let insideImports = false;
        let consumedUntil = -1;
        
        outerLoop: for (const [lineIndex, line] of lines.entries()) {
            if (lineIndex < consumedUntil) continue;
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
            if (projectHeadings.has(trimmed)) continue;

            for (const prefix of PREFIXES_OPEN) {
                if (trimmed.startsWith(prefix)) {
                    consumedUntil = this.taskBlockEnd(lines, lineIndex);
                    openTodo.push({ text: lines.slice(lineIndex, consumedUntil).join('\n'), project: localProject });
                    continue outerLoop;
                }
            }

            for (const prefix of PREFIXES_COMPLETED) {
                if (trimmed.startsWith(prefix)) {
                    consumedUntil = this.taskBlockEnd(lines, lineIndex);
                    completedTodo.push({ text: lines.slice(lineIndex, consumedUntil).join('\n'), project: localProject });
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
            const project = this.projectForPath(task.sourcePath);
            if (task.status === ' ') {
                openTodo.push({ text, project });
            } else {
                completedTodo.push({ text, project });
            }
        }

        const newLines = [];

        newLines.push(...otherLines);

        newLines.push('');
        newLines.push(HEADER_OPEN);
        newLines.push(...this.projectTaskLines(openTodo));

        newLines.push('');
        newLines.push(HEADER_COMPLETE);
        newLines.push(...this.projectTaskLines(completedTodo));

        return newLines.join('\n');
    }

    async scanTodos() {
        this.todoIndex.clear();
        this.dashboardPaths.clear();
        for (const file of this.app.vault.getMarkdownFiles()) {
            await this.indexTodos(
                file,
                this.app.metadataCache.getFileCache(file)
            );
        }
    }

    queueUpdate(update) {
        this.updateQueue = this.updateQueue.then(update).catch(console.error);
    }

    async refreshDashboards() {
        const blocked = new Set();
        const snapshots = new Map();
        for (const path of this.dashboardPaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;
            const latest = await this.app.vault.read(file);
            if (this.checkPluginActive(latest)) {
                snapshots.set(path, latest);
                await this.syncDashboardTasks(path, latest);
                const writeback = await this.syncNewDashboardItems(path, latest);
                if (writeback !== true) {
                    blocked.add(path);
                    this.writebackWarnings ??= new Set();
                    if (writeback !== 'editing' && !this.writebackWarnings.has(path)) {
                        new obsidian.Notice('New dashboard items were kept in place because their source changed or could not be identified safely.');
                        this.writebackWarnings.add(path);
                    }
                } else {
                    this.writebackWarnings?.delete(path);
                }
            }
        }
        const tasks = this.getAllTodos();
        const nextImports = tasks.map(task => this.importedTaskLine(task));
        for (const path of this.dashboardPaths) {
            if (blocked.has(path)) continue;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                continue;
            }

            const content = await this.app.vault.read(file);
            if (!this.checkPluginActive(content)) continue;
            if (content !== snapshots.get(path)) {
                this.queueUpdate(() => this.refreshDashboards());
                continue;
            }
            const previousImports = this.importTracking.get(path) ?? [];

            const before = JSON.stringify(this.importSources.get(path));
            let result = content;
            let superseded = false;
            if (content !== this.recreatePluginStructure(content, tasks, previousImports, path)) {
                await this.app.vault.process(file, latest => {
                    if (latest !== content) {
                        superseded = true;
                        return latest;
                    }
                    result = this.checkPluginActive(latest)
                        ? this.recreatePluginStructure(latest, tasks, previousImports, path) : latest;
                    return result;
                });
            }
            if (superseded) {
                this.queueUpdate(() => this.refreshDashboards());
                continue;
            }
            if (this.checkPluginActive(result)) {
                const previousHeadings = JSON.stringify(this.projectHeadings.get(path));
                this.projectHeadings.set(path, Array.from(new Set([
                    `#### ${this.projectForPath(path)}`,
                    ...tasks.map(task => `#### ${this.projectForPath(task.sourcePath)}`)
                ])));
                this.trackDashboardImports(path, result, tasks);
                this.importTracking.set(path, nextImports);
                if (before !== JSON.stringify(this.importSources.get(path)) ||
                    previousHeadings !== JSON.stringify(this.projectHeadings.get(path)) ||
                    JSON.stringify(previousImports) !== JSON.stringify(nextImports)) {
                    await this.saveImportTracking();
                }
            }
        }
    }

    async saveImportTracking() {
        this.pluginData.settings = { ...this.settings };
        this.pluginData.importedTaskLines = Object.fromEntries(this.importTracking);
        this.pluginData.importedTaskSources = Object.fromEntries(this.importSources);
        this.pluginData.projectHeadings = Object.fromEntries(this.projectHeadings);
        await this.saveData(this.pluginData);
    }

    getTaskSource(path, lineNumber, content) {
        const lines = content.split('\n');
        const text = lines[lineNumber] ?? '';
        if (!/^\s*[-*]\s+\[[ xX]\]/.test(text)) {
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
        const line = this.findSourceTaskLine(lines, source);
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

    async onload() {
        console.log('ToDoList plugin is on!');
        this.todoIndex = new Map();
        this.dashboardPaths = new Set();
        this.updateQueue = Promise.resolve();
        this.pluginData = await this.loadData() ?? {};
        this.settings = { importTag: this.normalizeImportTag(this.pluginData.settings?.importTag) ?? DEFAULT_SETTINGS.importTag };
        this.addSettingTab(new ToDoListSettingTab(this.app, this));
        this.projectHeadings = new Map(Object.entries(this.pluginData.projectHeadings ?? {})
            .filter(([path, headings]) => Array.isArray(headings) && headings.every(heading => typeof heading === 'string')));
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
                    const latest = await this.app.vault.read(file);
                    if (latest !== content && this.todoIndex.has(file.path)) {
                        await this.reindexSource(file, latest);
                    } else {
                        await this.indexTodos(file, cache, latest);
                    }
                    await this.refreshDashboards();
                });
            })
        );

        this.registerEvent(
            this.app.vault.on('modify', file => {
                if (!(file instanceof TFile)) return;
                if (this.dashboardPaths.has(file.path)) {
                    this.queueUpdate(() => this.refreshDashboards());
                } else if (this.todoIndex.get(file.path)?.length) {
                    this.queueUpdate(async () => {
                        await this.reindexSource(file, await this.app.vault.read(file));
                        await this.refreshDashboards();
                    });
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
                            this.projectHeadings.delete(path);
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
                            const headings = this.projectHeadings.get(path);
                            this.projectHeadings.delete(path);
                            if (headings) this.projectHeadings.set(file.path + path.slice(oldPath.length), headings);
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

class ToDoListSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        this.containerEl.empty();
        let tag = this.plugin.settings.importTag;
        new obsidian.Setting(this.containerEl)
            .setName('Task import tag')
            .setDesc('Only tasks with this tag are imported. Existing source tags are not renamed.')
            .addText(text => text.setPlaceholder('#task').setValue(tag).onChange(value => { tag = value; }))
            .addButton(button => button.setButtonText('Apply').setCta().onClick(async () => {
                button.setDisabled(true);
                try {
                    if (await this.plugin.updateImportTag(tag)) {
                        new obsidian.Notice('Task import tag updated.');
                        this.display();
                    }
                } finally {
                    button.setDisabled(false);
                }
            }));
    }
}

module.exports = ToDoList;
