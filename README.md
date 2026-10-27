# Master ToDo List

This is a small open source obsidian plugin used to centralize tasks/TODO's and prioritize based on user preference across an Obsidian workspace.

## Description
This plugin was inspired by a similar plugin that acts as a ToDo list that will organize by `Open` and `Closed` that are automatically generated once the file has been selected as the main file. The user is able to store checkboxes across their workspace, and the plugin will automatically organize them into the correct category. Checkboxes will also sort based on priority using built in emoji's used to indicate the severity of priority.

### Installing
## Installation

### From Obsidian Community Plugins (once approved)
1. Open **Settings** → **Community plugins**.
2. Click **Browse** and search for **ToDoList**.
3. Install and enable the plugin.

### Manual installation (before approval or for development)
1. Download the latest release from the [GitHub releases page](https://github.com/iamwestoff/master-todo-list/releases/).
2. Extract the files into `<your vault>/.obsidian/plugins/master-todo-list/`.
3. Reload Obsidian and enable the plugin in **Settings** → **Community plugins**.

## Usage
1. Add the HTML comment  `<!-- %% Master ToDo List %% -->` anywhere in any `.md` file (e.g., at the top or bottom).
2. Write your tasks to complete in any of these formats:
   - `- [ ] Task not done`
   - `* [ ] Another open task`
   - `- [x] Completed task`
   - `- [X] Completed task (capital X)`
   - `* [x] Completed with asterisk`
   - `* [X] Completed with asterisk and capital X`
3. Save the file. The plugin will automatically:
   - Move all open tasks under the heading `### Open`.
   - Move all completed tasks under the heading `### Completed`.
   - Keep all other text (non-task lines) at the top of the file.
   - Pull in all other tasks with the `#dashboard' tag.

## Authors
* Easton Herbon [@IamWestOff](https://twitter.com/iamwestoff)

## Version History
* 1.0.0
   * Initial Release!
* 1.0.1
   * Bug fixes and publication changes.
* 1.0.2
   * Bug fixes
        * Addressing legacy issues causing crashes.
        * Fixed issue where there was tasks not being marked off in both files.
   * Added ability to right-click to "Go to Original Task", and pull up file where task is located.

## Acknowledgments
* [todo-list](https://github.com/sasunhuevich/ToDoList)
