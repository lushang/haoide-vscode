/**
 * @file core commands
 * @author Mouse Liu <mouse.mliu@gmail.com>
 */

import * as vscode from 'vscode';
import * as _ from 'lodash';
import * as nls from 'vscode-nls';
import * as path from 'path';
import * as fs from 'fs';
import * as shelljs from 'shelljs';
import * as promiseLimit from 'promise-limit';
import * as xmlParser from 'fast-xml-parser';

import * as util from '../utils/util';
import * as utility from './utility';
import * as packages from '../utils/package';
import * as settingsUtil from '../settings/settingsUtil';
import MetadataApi from '../salesforce/api/metadata';
import ApexApi from '../salesforce/api/apex';
import RestApi from '../salesforce/api/rest';
import ToolingApi from '../salesforce/api/tooling';
import ProgressNotification from '../utils/progress';
import { _session, settings, metadata } from '../settings';
import { 
    SObjectDesc, 
    MetadataModel, 
    TestSuite, TestObject,
    DeployResult,
    Template,
    ConfirmAction,
    QueryResult,
    SObjectReloadScope,
    GlobalDescribe,
    SObjectSOQL
} from '../typings';
import { CheckRetrieveResult, CheckDeployResult } from '../typings/meta';
import { Manifest } from '../typings/manifest';

const localize = nls.loadMessageBundle();

/**
 * Build sobject soql by specified condition
 */
export function buildSobjectSOQL() {
    executeGlobalDescribe().then( async result => {
        // Choose sobject to generate soql
        let items = [];
        for (const sobject of result.sobjects) {
            if (sobject.queryable) {
                items.push({
                    label: sobject.name,
                    description: sobject.label
                });
            }
        }
        let chosenItem = await vscode.window.showQuickPick(items);
        if (!chosenItem) {
            return;
        }
        let sobjectName = chosenItem.label;

        // Get sobjects condition
        let condition = await vscode.window.showQuickPick([
            SObjectSOQL.ALL, 
            SObjectSOQL.CUSTOM,
            SObjectSOQL.UPDATEABLE,
            SObjectSOQL.CREATEABLE
        ], {
            placeHolder: 'Choose the condition for sobject SOQL to reload',
            ignoreFocusOut: true
        }) as string;
        if (!condition) {
            return;
        }

        // Start to describe sobject
        let restApi = new RestApi();
        return ProgressNotification.showProgress(
            restApi, "describeSobject", {
                sobject: sobjectName,
                progressMessage: "Excecuting describe request for " + sobjectName
            }
        )
        .then( (sobjectDesc: SObjectDesc) => {
            let fieldNames = [];
            for (const field of sobjectDesc.fields) {
                if (condition === SObjectSOQL.ALL) {
                    fieldNames.push(field.name);
                }
                else if (_.get(field, condition)) {
                    fieldNames.push(field.name);
                }
            }

            // Start to build soql and display it in a new view
            let soql = `SELECT ${fieldNames.join(', ')} FROM ${sobjectName}`;
            util.openNewUntitledFile(soql, 'sql');
        })
        .catch( err => {
            vscode.window.showErrorMessage(err.message);
        });
    });
}

/**
 * Command for executing globalDescribe REST request
 * 
 * @returns Promise<GlobalDescribe>
 */
export function executeGlobalDescribe() {
    return new Promise<GlobalDescribe>((resolve, reject) => {
        // Get global describe cache
        let result = settingsUtil.getGlobalDescribe();
        
        if (result && result.sobjects) {
            return resolve(result);
        }

        // Request from server if there is no global describe cache
        let restApi = new RestApi();
        return ProgressNotification.showProgress(
            restApi, "describeGlobal", {
            progressMessage: "Executing global describe request"
        })
        .then( (result: GlobalDescribe) => {
            settingsUtil.saveGlobalDescribe(result);
            resolve(result);
        })
        .catch(err => {
            reject(err);
        });
    });
}

/**
 * Update user language as your chosen
 */
export async function updateUserLanguage() {
    // Let user to choose language
    let chosenItem: any = await vscode.window.showQuickPick(
        _.map(settings.getUserLanguages(), (v, k) => {
            return {
                label: v, description: k
            };
        })
    );

    let restApi = new RestApi();
    ProgressNotification.showProgress(restApi, "patch", {
        "serverUrl": "/sobjects/User/" + _session.getUserId(),
        "data": {
            "LanguageLocaleKey": chosenItem.label
        },
        "progressMessage": "Updating user language"
    })
    .then( body => {
        vscode.window.showInformationMessage(
            `Your lanaguage is updated to ${chosenItem.description}`
        );
    });
}

/**
 * Execute rest test
 * 
 * @param options rest options, i.e., {
 *    serverUrl: ""
 *    method: "",
 *    data: {} | []
 * }
 */
export function executeRestTest(options: any) {
    let restApi = new RestApi();
    ProgressNotification.showProgress(
        restApi, options.method, _.extend(options, {
            progressMessage: "Executing REST Test"
        })
    )
    .then( result => {
        util.openNewUntitledFile(
            JSON.stringify(result, null, 4)
        );
    })
    .catch( err => {
        console.log(err);
        vscode.window.showErrorMessage(err.message);
    });
}

/**
 * Run sync test for active class file
 */
export function runSyncTest() {
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        let property = util.getFilePropertyByFileName(
            editor.document.fileName
        );
        
        runSyncTests([{
            classId: property.id,
            testMethods: [
                "testCommunitiesLoginController"
            ]
        }, {
            maxFailedTests: 2
        }]);
    }
    else {
        util.showCommandWarning();
    }
}

/**
 * Running sync test class
 * 
 * @param classIds ids of test class to be ran
 */
export function runSyncTests(testSuites: TestSuite[]) {
    let toolingApi = new ToolingApi();
    ProgressNotification.showProgress(
        toolingApi, "runSyncTest", {
            data: {
                "tests": testSuites
            },
            progressMessage: "Running test class, please wait"
        }
    )
    .then( result => {
        console.log(result);
    })
    .catch (err => {
        vscode.window.showErrorMessage(err.message);
    });
}

/**
 * Execute query and display result in new untitled file
 */
export function executeQuery(isTooling=false) {
    // Get selection in the active editor
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        let soql = editor.document.getText(editor.selection);

        let api = isTooling ? new ToolingApi() : new RestApi();
        ProgressNotification.showProgress(api, "query", {
            soql: soql,
            progressMessage: "Executing query request"
        })
        .then( result => {
            util.openNewUntitledFile(
                JSON.stringify(result, null, 4)
            );
        })
        .catch (err => {
            console.log(err);
            vscode.window.showErrorMessage(err.message);
        });
    }
}

/**
 * Reload symbol table of apex class, which is used 
 * by completion provider
 */
export function reloadSymbolTable() {
    let toolingApi = new ToolingApi();
    ProgressNotification.showProgress(toolingApi, "query", {
        soql: "SELECT Id, Name, SymbolTable FROM ApexClass",
        batchSize: 200,
        progressMessage: "This is a long time request, please wait..."
    })
    .then( (result: QueryResult) => {
        util.saveSymbolTables(result.records);

        // If it is not done, retrieve next records
        if (!result.done && result.nextRecordsUrl) {
            retrieveNextRecordsUrl(result.nextRecordsUrl);
        }

        // Recursive request for nextRecordsUrl until done
        function retrieveNextRecordsUrl(nextRecordsUrl: string) {
            ProgressNotification.showProgress(toolingApi, "get", {
                serverUrl: nextRecordsUrl,
                progressMessage: `Retrieving nextRecordsUrl: ${nextRecordsUrl}`
            })
            .then( (result: QueryResult) => {
                util.saveSymbolTables(result.records);

                if (result.nextRecordsUrl) {
                    retrieveNextRecordsUrl(result.nextRecordsUrl);
                }
            });
        }
    })
    .catch( err => {
        console.log(err.message);
        vscode.window.showErrorMessage(err.message);
    });
}

/**
 * Describe sobjects and keep it to local disk
 * 
 * @param sobjects sobjects array, if not spcified, just describe global
 */
export async function reloadSobjectCache(options?: any) {
    let restApi = new RestApi();

    let sobjects: string[] = (options && options.sobjects) || [];
    if (!sobjects || sobjects.length === 0) {
        // Get sobjects scope
        let scope = (options && options.scope) || await vscode.window.showQuickPick([
            SObjectReloadScope.ALL, 
            SObjectReloadScope.STANDARD, 
            SObjectReloadScope.CUSTOM,
            SObjectReloadScope.CUSTOMSCOPE
        ], {
            placeHolder: 'Choose the scope for sobject definitions to reload',
            ignoreFocusOut: true
        });
        if (!scope) {
            return;
        }

        return executeGlobalDescribe().then( async result => {
            let sobjectsDesc = result.sobjects;
            for (const sobjectDesc of sobjectsDesc) {
                // Ignore not queryable sobject
                if (!sobjectDesc.queryable) {
                    continue;
                }
                
                if (scope === SObjectReloadScope.ALL
                        || scope === SObjectReloadScope.CUSTOMSCOPE) {
                    sobjects.push(sobjectDesc.name);
                }
                else if (scope === SObjectReloadScope.STANDARD) {
                    if (!sobjectDesc.custom) {
                        sobjects.push(sobjectDesc.name);
                    }
                }
                else if (scope === SObjectReloadScope.CUSTOM) {
                    if (sobjectDesc.custom) {
                        sobjects.push(sobjectDesc.name);
                    }
                }
            }

            // Customscope means user can manually specify the scope
            let chosenSobjects;
            if (scope === SObjectReloadScope.CUSTOMSCOPE) {
                chosenSobjects = await vscode.window.showQuickPick(sobjects, {
                    canPickMany: true
                });
                if (!chosenSobjects) {
                    return;
                }
            }
            else {
                chosenSobjects = sobjects;
            }

            reloadSobjectCache({
                sobjects: chosenSobjects
            });

            vscode.window.showInformationMessage(
                "There is long time process to " + 
                "load sobjects cache, please wait..."
            );
        })
        .catch( err => {
            return vscode.window.showErrorMessage(err.message);
        });
    }

    var limit = promiseLimit(30);
    Promise.all(_.map(sobjects, sobject => {
        return limit(() => restApi.describeSobject({ 
            sobject: sobject,
            ignoreError: true
        }));
    }))
    .then( (sobjectsDesc : any) => {
        sobjectsDesc = sobjectsDesc as SObjectDesc[];

        let { sobjects = {},  parentRelationships = {} } = 
            settingsUtil.getSobjects();

        // Collect parentRelationships
        for (const sobjectDesc of sobjectsDesc) {
            // If no name, skip
            if (!sobjectDesc.name) {
                continue;
            }

            // Collect sobjects
            sobjects[sobjectDesc.name.toLowerCase()] =
                sobjectDesc.name;

            // Write different sobject describe result 
            // to different json file at local disk
            settingsUtil.saveSobjectDesc(sobjectDesc);

            for (const field of sobjectDesc.fields) {
                if (field.referenceTo.length !== 1) {
                    continue;
                }

                let rsName = field.relationshipName;
                let referenceTo = field.referenceTo[0];
                if (parentRelationships[rsName]) {
                    let referenceTos: string[] = parentRelationships[rsName];
                    referenceTos.push(referenceTo);
                    parentRelationships[rsName] = _.uniq(referenceTos);
                }
                else {
                    parentRelationships[rsName] = [referenceTo];
                }
            }
        }

        settingsUtil.setConfigValue("sobjects.json", {
            "sobjects": sobjects,
            "parentRelationships": parentRelationships
        });

        // Succeed message after finished
        vscode.window.showInformationMessage(
            "Your sobjects cache were saved at '.haoide'"
        );
    })
    .catch( err => {
        console.log(err);
        vscode.window.showErrorMessage(err.message);
    });
}

/**
 * Execute anonymous apex code
 * 
 * @param apexCode apex code to be exuected
 */
export function executeAnonymous(apexCode?: string) {
    // Get selection in the active editor
    let editor = vscode.window.activeTextEditor;
    if (editor && editor.selection) {
        apexCode = editor.document.getText(editor.selection) || "";
    }

    if (!apexCode) {
        let errorMsg = localize("noCodeExecute.text", "There is no code to execute");
        return vscode.window.showErrorMessage(errorMsg);
    }

    let apexApi = new ApexApi();
    let requestType = "executeAnonymous";
    ProgressNotification.showProgress(apexApi, requestType, { 
        "apexCode": util.quoteattr(apexCode)
    })
    .then( (body: string) => {
        if (body) {
            // If there is compile error, parse it as human-readable
            if (body.indexOf("<success>false</success>") !== -1) {
                let result = util.parseResult(body, requestType);

                let compileProblem = util.unescape(
                    result["compileProblem"]
                );
                let errorMsg = `${compileProblem} at line ` + 
                    `${result["line"]} column ${result["column"]}`;
                console.log(errorMsg);

                return vscode.window.showErrorMessage(errorMsg);
            }

            util.openNewUntitledFile(body, "apex");
        }
    })
    .catch( err => {
        console.log(err);
        vscode.window.showErrorMessage(err.message);
    });
}

/**
 * Describe metadata and kept it to local cache
 */
export function describeMetadata() {
    return new Promise<any>( (resolve, reject) => {
        ProgressNotification.showProgress(
            new MetadataApi(), "describeMetadata", {}
        )
        .then( (result: MetadataModel) => {
            metadata.setMetaObjects(result);

            vscode.window.showInformationMessage(
                "Metadata describe result has been kept to .config/metadata.json"
            );

            resolve(result);
        })
        .catch( err => {
            reject(err);
        });
    });
}

/**
 * Destruct files from server
 * 
 * @param files files to be destructed
 */
export async function destructFilesFromServer(files: string[]) {
    let yesOrNo = await vscode.window.showWarningMessage(
        "Are you sure you really want to remove these files from server",
        ConfirmAction.YES, ConfirmAction.NO
    );
    if (yesOrNo === ConfirmAction.NO) {
        return;
    }

    packages.buildDestructPackage(files).then( base64Str => {
        ProgressNotification.showProgress(
            new MetadataApi(), 'deploy', {
                zipfile: base64Str, 
                progressDone: false,
                progressMessage: "Destructing files from server"
            }
        )
        .then( result => {
            // If deploy failed, show error message
            if (!result["success"]) {
                // Get failure in deploy result
                let componentFailures: any = result.details.componentFailures;

                // If there is only one failure, wrap it with array
                if (componentFailures && !_.isArray(componentFailures)) {
                    componentFailures = [componentFailures];
                }

                if (_.isArray(componentFailures)) {
                    let problem: string = "";
                    for (const msg of componentFailures) {
                        problem += `[sf:deploy] ${msg.fileName} - ` +
                            `${util.unescape(msg.problem)}\n`;
                    }

                    return vscode.window.showErrorMessage(problem);
                }
            }
            else {
                // Remove files from local disk
                util.unlinkFiles(files);

                // Show succeed message
                vscode.window.showInformationMessage(
                    localize("fileDestructed.text",
                        "Files were deleted from server succesfully"
                    )
                );
            }
        })
        .catch( err => {
            vscode.window.showErrorMessage(err.message);
        });
    });
}

/**
 * Destruct active file from server
 */
export function destructThisFromServer() {
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        let fileName = editor.document.fileName;
        destructFilesFromServer([fileName]);
    }
    else {
        util.showCommandWarning();
    }
}

/**
 * Destruct open files from server
 */
export function destructOpenFilesFromServer() {
    let documents: vscode.TextDocument[] = vscode.workspace.textDocuments;
    if (documents) {
        let fileNames: string[] = [];
        for (const doc of documents) {
            fileNames.push(doc.fileName);
        }
        destructFilesFromServer(fileNames);
    }
    else {
        util.showCommandWarning();
    }
}

/**
 * Deploy active file to server
 */
export function deployThisToServer() {
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        // Save dirty file
        let fileName = editor.document.fileName;
        editor.document.save().then( () => {
            deployFilesToServer([fileName]);
        });
    }
    else {
        util.showCommandWarning();
    }
}

/**
 * Deploy open files to server
 */
export function deployOpenFilesToServer() {
    let documents: vscode.TextDocument[] = vscode.workspace.textDocuments;
    if (documents) {
        let fileNames: string[] = [];
        for (const doc of documents) {
            // Save dirty file
            doc.save().then( () => {
                fileNames.push(doc.fileName);
            });
        }
        deployFilesToServer(fileNames);
    }
    else {
        util.showCommandWarning();
    }
}

/**
 * Deploy files to server
 * 
 * @param files files to be deployed
 */
export function deployFilesToServer(files: string[]) {
    packages.buildDeployPackage(files).then( base64Str => {
        ProgressNotification.showProgress(
            new MetadataApi(), 'deploy', {
                zipfile: base64Str, 
                progressDone: false,
                progressMessage: "Deploying files to server"
            }
        )
        .then( (result: CheckDeployResult) => {
            // If deploy failed, show error message
            if (!result.success) {
                // Get failure in deploy result
                let componentFailures: any = result.details.componentFailures;

                // If there is only one failure, wrap it with array
                if (componentFailures && !_.isArray(componentFailures)) {
                    componentFailures = [componentFailures];
                }

                if (_.isArray(componentFailures)) {
                    let problem: string = "";
                    for (const msg of componentFailures) {
                        problem += `[sf:deploy] ${msg.fileName} - ` +
                            `${util.unescape(msg.problem)}\n`;
                    }

                    return vscode.window.showErrorMessage(problem);
                }
            }
            else {
                // Update the lastModifiedDate of local file property
                util.updateFilePropertyAfterDeploy(result);

                // Show succeed message
                vscode.window.showInformationMessage(
                    localize("fileDeployed.text", 
                        "Files were deployed to server succesfully"
                    )
                );
            }
        });
    });
}


/**
 * Refresh body of active file from server
 */
export function refreshThisFromServer() {
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        // Get file property
        let fileName = editor.document.fileName;
        let filep = util.getFilePropertyByFileName(fileName);

        // Send get request
        let restApi = new RestApi();
        ProgressNotification.showProgress(restApi, "get", {
            serverUrl: `/sobjects/ApexClass/${filep.id}`,
            progressMessage: "Refreshing file from server"
        })
        .then( result => {
            fs.writeFileSync(fileName, result["Body"], "utf-8");
        })
        .catch( err => {
            vscode.window.showErrorMessage(err.message);
        });
    } 
    else {
        util.showCommandWarning();
    }
}

/**
 * Retireve active file from server
 */
export function retrieveThisFromServer() {
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        retrieveFilesFromServer([editor.document.fileName]);
    }
    else {
        util.showCommandWarning();
    }
}

/**
 * Retrieve open files from server
 */
export function retrieveOpenFilesFromServer() {
    let documents: vscode.TextDocument[] = vscode.workspace.textDocuments;
    if (documents) {
        retrieveFilesFromServer(_.map(documents, doc => {
            return doc.fileName;
        }));
    }
    else {
        util.showCommandWarning();
    }
}

/**
 * Retrieve files from server
 * @param fileNames files to be retrieved
 */
export function retrieveFilesFromServer(fileNames: string[]) {
    let retrieveTypes = packages.getRetrieveTypes(fileNames);
    ProgressNotification.showProgress(
        new MetadataApi(), 'retrieve', {
            types: retrieveTypes,
            progressDone: false,
            progressMessage: "Retrieving files from server"
        }
    )
    .then( (result: CheckRetrieveResult) => {
        // Show error message as friendly format if have
        let messages: any = result.messages;
        if (messages && !_.isArray(messages)) {
            messages = [messages];
        }

        if (_.isArray(messages)) {
            let problem: string = "";
            for (const msg of messages) {
                problem += `[sf:retrieve] ${msg.fileName} - ` +
                    `${util.unescape(msg.problem)}\n`;
            }

            return vscode.window.showErrorMessage(problem);
        }

        // Extract retrieved zipFile
        packages.extractZipFile(result.zipFile);

        // Keep fileProperties to local disk
        util.setFileProperties(result.fileProperties);
    });
}

export function refreshFolders(uris: vscode.Uri[] | undefined) {
    if (!uris) {
        return;
    }

    // Get metadata folder of chosen folder
    let metaFolders = _.map(uris, uri => {
        return path.basename(uri.fsPath);
    });

    // Build retrieveTypes
    let retrieveTypes: any = {};
    for (const metaFolder of metaFolders) {
        let xmlName = metadata.getXmlName(metaFolder);
        if (xmlName) {
            retrieveTypes[xmlName] = ['*'];
        }
    }

    // Start to retrieve from server
    ProgressNotification.showProgress(
        new MetadataApi(), 'retrieve', {
            types: retrieveTypes,
            progressDone: false,
            progressMessage: "Refresh folders from server"
        }
    )
    .then( (result: CheckRetrieveResult) => {
        // Show error message as friendly format if have
        let messages: any = result.messages;
        if (messages && !_.isArray(messages)) {
            messages = [messages];
        }

        if (_.isArray(messages)) {
            let problem: string = "";
            for (const msg of messages) {
                problem += `[sf:retrieve] ${msg.fileName} - ` +
                    `${util.unescape(msg.problem)}\n`;
            }

            return vscode.window.showErrorMessage(problem);
        }

        // Extract retrieved zipFile
        packages.extractZipFile(result.zipFile, {
            ignorePackageXml: true
        });
        vscode.window.showInformationMessage(
            "Your folders was successfully refreshed"
        );
    });
}

export function retrieveByManifest() {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    // Read data from active file
    let activeFileName = editor.document.fileName;
    let manifest: Manifest;
    try {
        let data = fs.readFileSync(activeFileName, 'utf-8');
        manifest = xmlParser.parse(data) as Manifest;
    }
    catch (err) {
        return vscode.window.showErrorMessage(err.message);
    }


    // Types parsed by xmlParser could be array or object,
    // should wrap it to array
    let types = manifest.Package.types;
    if (!_.isArray(types)) {
        types = [types];
    }

    // Build retrieveTypes
    let retrieveTypes: any = {};
    for (const _type of types) {
        // Members can be array or object
        let members = _type.members;
        if (!_.isArray(members)) {
            members = [members];
        }

        retrieveTypes[_type.name] = members;
    }

    ProgressNotification.showProgress(
        new MetadataApi(), 'retrieve', {
            types: retrieveTypes,
            progressDone: false,
            progressMessage: "Retrieving manifest from server"
        }
    )
    .then( (result: CheckRetrieveResult) => {
        // Show error message as friendly format if have
        let messages: any = result.messages;
        if (messages && !_.isArray(messages)) {
            messages = [messages];
        }

        if (_.isArray(messages)) {
            let problem: string = "";
            for (const msg of messages) {
                problem += `[sf:retrieve] ${msg.fileName} - ` +
                    `${util.unescape(msg.problem)}\n`;
            }

            return vscode.window.showErrorMessage(problem);
        }

        // Extract retrieved zipFile
        let extractedTo = path.dirname(activeFileName);
        packages.extractZipFile(result.zipFile, extractedTo);
        vscode.window.showInformationMessage(
            `Your manifest was retrieved to ${extractedTo}`
        );
    });
}

/**
 * Update project according to subscribed meta objects
 */
export function updateProject() {
    return createNewProject(false);
}

/**
 * Create new project based on subscribed metadata objects
 */
export function createNewProject(reloadCache = true) {
    let subscribedMetaObjects = settings.getSubscribedMetaObjects();

    // If there is no subscribed metaObjects, so subscribe first
    if (!subscribedMetaObjects || subscribedMetaObjects.length === 0) {
        if (!metadata.getMetaObjects()) {
            return describeMetadata().then( () => {
                createNewProject(reloadCache);
            });
        }

        return utility.toggleMetadataObjects()
            .then( metaObjects => {
                if (!metaObjects || metaObjects.length === 0) {
                    return vscode.window.showWarningMessage(
                        localize("noSubscribedMetadata.text", 
                            "No subscribed metaObjects for this project"
                        )
                    );
                }

                createNewProject(reloadCache);
            });
    }

    let retrieveTypes: any = {};
    for (const mo of subscribedMetaObjects) {
        retrieveTypes[mo] = ["*"];
    }

    ProgressNotification.showProgress(
        new MetadataApi(), 'retrieve', {
            types: retrieveTypes,
            progressDone: false,
            progressMessage: "Retrieving files from server"
        }
    )
    .then( (result: CheckRetrieveResult) => {
        // Extract retrieved zipFile
        packages.extractZipFile(result.zipFile);

        // Keep fileProperties to local disk
        util.setFileProperties(result.fileProperties);

        // Reload sObject cache
        if (reloadCache) {
            reloadSobjectCache({ 
                scope: SObjectReloadScope.ALL
            });
        }

        // Copy .gitignore file and .eslintrc to default project 
        util.copyResourceFiles();
    })
    .catch(err => {
        console.error(err);
        vscode.window.showErrorMessage(err.message);
    });
}

/**
 * Create specified new metadata object, it supports creating
 * ApexClass, ApexTrigger, VisualforcePage, Visualforce Component,
 * lwc and aura
 * 
 * @param metaType metadata type to be created
 */
export async function createMetaObject(metaType: string) {
    // Get metaObject name from user input
    let metaObjectName = await vscode.window.showInputBox({
        placeHolder: "Input your component name"
    });
    if (!metaObjectName) {
        return;
    }

    // Get extension instance
    const extension = util.getExtensionInstance();
    if (!extension) {
        return;
    }

    // Get path of templates folder of extension
    const templateFolder = path.join(
        extension.extensionPath,
        'resources', 'templates'
    );
    
    // Get file path of templates.json
    const templateFile = path.join(
        templateFolder, "templates.json"
    );
    
    // Get templates defined by haoide
    let templates: any = {};
    try {
        let data = fs.readFileSync(templateFile, "utf-8");
        templates = JSON.parse(data);
    }
    catch (err) {
        return vscode.window.showErrorMessage(err.message);
    }

    // Get specified template by metaType
    let template: any = templates[metaType];
    let chosenItem: any = await vscode.window.showQuickPick(
        _.map(template, (v, k) => {
            return {
                label: k,
                description: v.description || v.directory
            };
        })
    );
    if (!chosenItem) {
        return;
    }

    // Get template attribute of chosen template
    let templateAttrs: Template[] | Template = template[chosenItem.label];
    if (!_.isArray(templateAttrs)) {
        templateAttrs = [templateAttrs];
    }

    // Get sobject name from user input
    let sObjectName;
    if (metaType === "ApexTrigger") {
        await executeGlobalDescribe().then( async result => {
            // Choose sobject to generate soql
            let quickItems = [];
            for (const sobject of result.sobjects) {
                if (sobject.triggerable) {
                    quickItems.push({
                        label: sobject.name,
                        description: sobject.label
                    });
                }
            }
            let chosenItem = await vscode.window.showQuickPick(quickItems);
            if (!chosenItem) {
                return;
            }
            sObjectName = chosenItem.label;
        });

        if (!sObjectName) {
            return;
        }
    }

    let targetFiles = [];
    let yesOrNo;
    for (const templateAttr of templateAttrs) {
        // Get file path of template
        let sourceFile = path.join(
            templateFolder, templateAttr.sourceDirectoryName
        );
        let data = fs.readFileSync(sourceFile, "utf-8");
        data = util.replaceAll(data, [
            {
                from: "{MetaObject_Name__c}",
                to: metaObjectName
            }, {
                from: "{API_Version__c}",
                to: "46"
            }, {
                from: "{Sobject_Name__c}",
                to: sObjectName || ""
            }
        ]);

        // Create target folder if not exists
        let targetFolder = path.join(
            util.getProjectPath(), "src",
            templateAttr.targetDirectoryName,
            templateAttr.inFolder
                ? (metaType === "LWC" 
                    ? _.lowerFirst(metaObjectName) 
                    : metaObjectName)
                : ""
        );
        if (!fs.existsSync(targetFolder)) {
            shelljs.mkdir("-p", targetFolder);
        }

        // Get target file path
        let targetFile = path.join(targetFolder,
            metaType === "LWC"
                ? _.lowerFirst(metaObjectName) + templateAttr.extension
                : metaObjectName + templateAttr.extension
        );
        targetFiles.push(targetFile);

        // Check confict
        if (!yesOrNo && fs.existsSync(targetFile)) {
            yesOrNo = await vscode.window.showWarningMessage(
                `${targetFile} is already exist, continue?`,
                ConfirmAction.OVERRIDE, ConfirmAction.NO
            );
            if (yesOrNo === ConfirmAction.NO) {
                return;
            }
        }
        
        // Write template content to target file
        fs.writeFileSync(targetFile, data, "utf-8");
    }

    // Open newly created files
    for (const file of targetFiles) {
        if (!file.endsWith("-meta.xml")) {
            vscode.commands.executeCommand(
                "vscode.open", vscode.Uri.file(file)
            );
        }
    }

    // Deploy newly created files to server
    deployFilesToServer(targetFiles);
}
