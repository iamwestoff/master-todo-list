# Master-ToDo-List

This is a small open source obsidian plugin used to centralize tasks/TODO's and prioritize based on user preference across an Obsidian workspace.

## Description
This plugin was inspired by a similar plugin that acts as a ToDo list that will organize by `Open` and `Closed` that are automatically generated once the file has been selected as the main file. The user is able to store checkboxes across their workspace, and the plugin will automatically organize them into the correct category. Checkboxes will also sort based on priority using built in emoji's used to indicate the severity of priority.

## How to use
In order to have the plugin track your checkboxes you must set a tag to the file you want to track your TODO checkboxes using an HTML tag.
``` html
<!-- %% Master ToDo List %% -->
```
To delimit what tasks you want organized into your master todo list, you must use the `dashboard` tag at the end of each task to be able to have the plugin pick up and organize it accordingly.

Local checkboxes will be automatically stored without using the `dashboard` tag.

## Getting Started

### Dependencies

There are no dependencies for this plugin.

### Installing
#### Locally
*  Download via this repository.
*  Unpack to the C:/ObsidianDownloadLocation/.../plugins/master-todo-list
*  Enjoy!

#### Via Obsidian
* Can be found under community plugins via `Master ToDo List`

## Authors

Contributors names and contact info
* Easton Herbon [@IamWestOff](https://twitter.com/iamwestoff)

## Version History
* 1.0
    * Initial Release

## Acknowledgments
* [todo-list](https://github.com/sasunhuevich/ToDoList)
