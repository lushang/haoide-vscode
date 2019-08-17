import * as opn from "open";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as _ from "lodash";
import * as vscode from "vscode";
import * as xmlParser from "fast-xml-parser";
import * as packageUtil from "../utils/package";
import * as settingsUtil from "../settings/settingsUtil";
import { extensionSettings } from "../settings";
import { FileAttributes } from "../utils/package";

export function openWithBrowser(url: string) {
    opn(url).catch(_ => {
        console.log(`Has error when open ${url}`);
    });
}

/**
 * Replace all matched oldText to newText in the spcified text
 * @param text Text to be replaced
 * @param from oldText
 * @param to newText
 */
export function replaceAll(text: string, from: string, to: string) {
    while (text.indexOf(from) !== -1) {
        text = text.replace(from, to);
    }

    return text;
}

/**
 * Parse Metadata api response body as JSON format
 * @param body Metadata Api request response body
 * @param requestType Metadata Api request type, i.e., executeAnonymous, retrieve
 * @returns JSON formated body
 */
export function parseResult(body: string, requestType: string) {
    let parseResult = xmlParser.parse(body);
    let soapenvBody = parseResult["soapenv:Envelope"]["soapenv:Body"];
    let result = soapenvBody[`${_.lowerFirst(requestType)}Response`]["result"];

    return result;
}

/**
 * Create status bar item
 * @param text text to show in the status bar
 * @param tooltip text to display when hove on it
 */
export function setStatusBarItem(text: string, tooltip?: string) {
    let haoideStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, 9999
    );

    haoideStatusBarItem.text = text;
    haoideStatusBarItem.tooltip = tooltip || "";
    haoideStatusBarItem.show();
}

export function parseIdUrl(idUrl: string) {
    var idUrls = idUrl.split("/");
    var userId = idUrls.pop(), orgId = idUrls.pop();

    return {
        "userId": userId,
        "organizationId": orgId
    };
}

/**
 * Open a new untitled file and display specified content
 * @param content Content to display in the newUntitile file
 */
export function openNewUntitledFile(content: string, languageId?: string) {
    let editor = vscode.window.activeTextEditor;
    vscode.commands.executeCommand("workbench.action.files.newUntitledFile")
        .then(() => {
            editor = vscode.window.activeTextEditor;
            if (editor) {
                // Set language of the untitled file
                languageId = languageId || "json";
                vscode.languages.setTextDocumentLanguage(
                    editor.document, languageId
                );
                
                // Insert content to new open file from start
                editor.edit(editBuilder => {
                    editBuilder.insert(new vscode.Position(0, 0), content);
                });
            }
        });
}

export function getExtensionWorkspace() {
    let _workspace = extensionSettings.getConfigValue(
        "workspace", ""
    );

    if (!_workspace) {
        _workspace = path.join(os.homedir(), "workspace");
    }

    if (!fs.existsSync(_workspace)) {
        fs.mkdirSync(_workspace);
    }

    return _workspace;
}

export function getProjects() {
    try {
        let configFile = path.join(os.homedir(), ".haoide", "config.json");
        let data = fs.readFileSync(configFile, "utf-8");
        return JSON.parse(data);
    }
    catch (err) {
        throw new Error(`Not found config.json file due to ${err}`);
    }
}

/**
 * Set project as default one in the same workspace
 * @param projectName project name to be set as default
 */
export function setDefaultProject(projectName: string) {
    let configPath = path.join(os.homedir(), ".haoide");
    if (!fs.existsSync(configPath)) {
        fs.mkdirSync(configPath);
    }

    // Read content from config.json
    let configFile = path.join(configPath, "config.json");
    let config: any = {};
    if (fs.existsSync(configFile)) {
        let data = fs.readFileSync(configFile, "utf-8");
        config = JSON.parse(data);

        // Set all exist project as non-default
        for (const projectName in config) {
            if (config.hasOwnProperty(projectName)) {
                config[projectName] = false;
            }
        }
    }

    // Set new project as default
    config[projectName] = true;

    // Write file to local cache
    fs.writeFileSync(configFile, JSON.stringify(config, null, 4));
}

/**
 * Get default projectName in config.json under the home dir
 * @returns Default projectName
 */
export function getDefaultProject(): string {
    let configFile = path.join(os.homedir(), ".haoide", "config.json");
    try {
        let data = fs.readFileSync(configFile, "utf-8");
        let config = JSON.parse(data);

        for (const projectName in config) {
            if (config.hasOwnProperty(projectName)) {
                if (config[projectName]) {
                    return projectName;
                }
            }
        }

        return "";
    } 
    catch (error) {
        console.log('Exception at getDefaultProject: ' + error);
        throw new Error(`Not found config.json at ${configFile}`);
    }
}

/**
 * Get path of project
 * @param projectName If null, means default project
 * @returns project path
 */
export function getProjectPath(projectName?: string) {
    // If projectName is null, just fetch the default project
    if (!projectName) {
        projectName = getDefaultProject();
    }

    let _workspace = getExtensionWorkspace();
    let projectPath = path.join(_workspace, projectName);

    if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath);
    }

    return projectPath;
}

export function addProjectToWorkspace(projectName: string) {
    let projectFolder = getProjectPath(projectName);
    let folders = vscode.workspace.workspaceFolders || [];
    vscode.workspace.updateWorkspaceFolders(
        folders.length, null, {
            uri: vscode.Uri.file(projectFolder),
            name: projectName
        }
    );
}

/**
 * Parse metaFolder, folder and name from fileName
 * @param fileName fileName with relative path, i.e.,
 *      1. unpackage/triggers/RejectTrigger.trigger
 *      2. unpackage/aura/CampaignItem/CampaignItemController.js
 * @returns file attributes, for example, {
 *      "metaFolder": "aura" | "triggers",
 *      "folder": "CampaignItem" | "",
 *      "fullName": "CampaignItemController.js" | "RejectTrigger.trigger"
 * }
 */
export function parseFileName(fileName: string) {
    let folderCmpInfo: string[] = fileName.split("/");
    let attributes = {};
    if (folderCmpInfo.length === 4) {
        attributes = {
            "metaFolder": folderCmpInfo[1],
            "folder": folderCmpInfo[2],
            "fullName": folderCmpInfo[3]
        };
    }
    else if (folderCmpInfo.length === 3) {
        attributes = {
            "metaFolder": folderCmpInfo[1],
            "folder": "",
            "fullName": folderCmpInfo[2]
        };
    }

    return attributes;
}

/**
 * Keep fileProperties from retrieve/deploy response to local disk
 * @param fileProperties fileProperties from retrieve/deploy response
 * @returns {
 *      
 * }
 */
export function setFileProperties(fileProperties: any[]) {
    let componentMetadata: any = {};
    for (let fileProperty of fileProperties) {
        let attributes: any = parseFileName(fileProperty["fileName"]);
        let fullName = attributes["fullName"];
        let metaFolder = attributes["metaFolder"];

        // Extend attrbutes to file property
        fileProperty = _.extend(fileProperty, attributes);

        if (!componentMetadata[metaFolder]) {
            componentMetadata[metaFolder] = {};
        }

        componentMetadata[metaFolder][fullName] = fileProperty;

        // Keep component metadata to local disk
        settingsUtil.setConfigValue("componentMetadata.json", componentMetadata);
    }
}

/**
 * Get file property by file uri
 * @param fileName file Uri
 * @returns fileProperty, including, id, metaFolder, xmlName...
 */
export function getFilePropertyByFileName(fileName: string) {
    let attrs: FileAttributes = packageUtil.getFileAttributes(fileName);
    
    let fileProperties = settingsUtil.getConfig(
        "componentMetadata.json"
    );
    console.log(fileProperties);

    try {
        return fileProperties[attrs.directoryName][attrs.fullName];
    }
    catch (err) {
        console.error(err);
        return {};
    }
}