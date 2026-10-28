# Master ToDo List

An open-source Obsidian plugin that gathers selected tasks across your vault into a master list, organized by status, project, and priority.

## Description
Mark a note as a dashboard to automatically organize its tasks under **Open** and **Completed**. Import tasks from other notes using a configurable tag, group them by project, and check them off from the dashboard without losing their original location. This plugin was inspired by [todo-list](https://github.com/sasunhuevich/ToDoList).

## Installation

### From Obsidian Community Plugins (once approved)
1. Open **Settings** → **Community plugins**.
2. Click **Browse** and search for **Master ToDo Tab**.
3. Install and enable the plugin.

### Manual installation (before approval or for development)
1. Download the latest release from the [GitHub releases page](https://github.com/iamwestoff/master-todo-list/releases/).
2. Place the plugin's `main.js` and `manifest.json` directly in `<your vault>/.obsidian/plugins/master-todo-list/`.
3. Reload Obsidian and enable the plugin in **Settings** → **Community plugins**.

## Usage

### Create a dashboard

Add this comment anywhere in a Markdown note:

```html
<!-- %% Master ToDo List %% -->
```

Tasks written directly in the dashboard do not need an import tag. Supported local checkbox formats are `- [ ]`, `* [ ]`, `- [x]`, `- [X]`, `* [x]`, and `* [X]`.

The plugin automatically organizes tasks under `### Open` and `### Completed`, with `#### Project name` headings inside each section. Other non-task text is kept above the generated sections. Use a dedicated dashboard note, since its task layout is managed by the plugin.

### Import tasks from other notes

Add `#dashboard` as a separate, space-delimited tag on each task you want to import:

```markdown
- [ ] Confirm interface mappings #dashboard
- [x] Collect requirements #dashboard
```

Untagged tasks in other notes are not imported. A note's folder or `project` property controls grouping, not whether its tasks are selected. Notes containing the dashboard activation comment are treated as dashboards rather than task sources.

### Choose the import tag

Open **Settings > Master ToDo Tab > Task import tag**, enter your preferred tag, and click **Apply**. The default is `#dashboard`; names such as `#focus` and `#work/tasks` are also supported. A leading `#` is added if omitted.

The setting is saved for the vault and applies to all dashboards. Applying a change rescans tasks automatically. It does not rename tags in source notes: old-tag-only tasks stop being imported, while tasks carrying the new tag are included. Dashboard-local tasks are retained.

### Set project names

By default, an imported task uses its source note's **immediate parent folder** as its project name. For example, `Projects/Client/Meetings/Notes.md` groups under **Meetings**.

To override the folder name, add a **text property** named `project` to the source note using Obsidian's Properties panel. Alternatively, add YAML frontmatter at the very top of the note:

```yaml
---
project: SIUMED - Dentrix
---
```

All imported tasks from that note use this project name. Notes in different folders can share a group by using the same property value. Empty or non-text project properties fall back to the folder name. Root-level notes without a project name use **Unassigned**.

Dashboard-local tasks use the dashboard note's own project property or immediate parent folder. Projects are sorted alphabetically within Open and Completed; empty groups are omitted, and stale generated project headings are removed when project names change.

Example dashboard:

```markdown
### Open
#### SIUMED - Dentrix
- [ ] Confirm interface mappings #dashboard

### Completed
#### SIUMED - Dentrix
- [x] Collect requirements #dashboard
```

### Priority sorting

Within each project, tasks are sorted in this order: 🔺, ⏫, 🔼, 🔽, ⏬, then tasks without a priority marker.

### Complete or reopen imported tasks

Checking or unchecking an imported task updates the original checkbox in its source note. The original task stays in place, and the dashboard copy moves to the appropriate status section. Source-note changes also refresh the dashboard.

Synchronization handles `✅ YYYY-MM-DD` completion dates and reordered priority/tag metadata, including changes made by other plugins. Completing a task carries its completion date back to the source; reopening removes that date. Source formatting and block IDs are preserved during checkbox updates.

Source references are stored in the plugin's data, not appended to task text. Old `%% ToDoListSource: ... %%` annotations are removed on refresh after updating and reloading the plugin. Recovery of old open/completed duplicates is limited to uniquely tracked sources with matching completion dates. If a source cannot be identified safely, it is left unchanged.

### Go to the original task

In **editing mode or Live Preview**, right-click an imported task line and choose **Go to original task**. The plugin opens the source note and selects the task, locating moved tasks by their block ID or matching task text when possible.

The menu option applies to tracked imports, not dashboard-local tasks. If the original note is missing or the task cannot be located safely, a notice is shown instead of opening an unrelated task.

## Authors
* Easton Herbon [@IamWestOff](https://twitter.com/iamwestoff)

## Version History
### Current release
* 1.0.3
   * Bug fixes 
      * Sub tasks not staying with parent tasks when created in dashboard now fixed.
   * Functionality
      * Added ability to change tag to user specified value.
      * User can now create tasks/subtasks under assigned categories, and they will populate to their source file.

### Previous releases
* 1.0.0
   * Initial Release!
* 1.0.1
   * Bug fixes and publication changes.
* 1.0.2
   * Bug fixes
      * Addressing legacy issues causing crashes.
      * Fixed issue where there was tasks not being marked off in both files.
   * Changes/Updates
      * Added ability to right-click to "Go to Original Task", and pull up file where task is located.

## Acknowledgments
* [todo-list](https://github.com/sasunhuevich/ToDoList)
