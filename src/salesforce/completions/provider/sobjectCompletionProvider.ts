/**
 * @file Apex completion provider
 * @author Mouse Liu <mouse.mliu@gmail.com>
 */

import * as vscode from "vscode";
import * as _ from "lodash";
import { TextDocument, Position, CompletionItem, CompletionItemKind, Range } from "vscode";

import * as util from "../utils/util";
import { createCompletionItem } from "../utils/util";
import * as settingsUtil from "../../../settings/settingsUtil";
import { extensionSettings } from "../../../settings";
import { PositionOption } from "../models/completion";

export class SobjectCompletionItemProvider implements vscode.CompletionItemProvider {

    public provideCompletionItems(document: TextDocument,
        position: Position, token: vscode.CancellationToken,
        context: vscode.CompletionContext) {

        let enableDebugMode = extensionSettings.getConfigValue(
            "enable-debug-mode", true
        );

        // We can't get correct word if remove -1
        let wordRange = document.getWordRangeAtPosition(
            new Position(position.line, position.character - 1), /[\w]+[\w-]*/g
        ) || new Range(position, position);

        let pos: PositionOption = {
            offset: document.offsetAt(position),
            wholeText: document.getText(),
            lineText: document.lineAt(position.line).text,
            char: util.getLastCharOfPosition(document, position),
            word: document.getText(wordRange).trim()
        };

        if (enableDebugMode) {
            console.log(pos);
        }
        
        // Initiate completion list
        let completionItems: CompletionItem[] = [];

        // Get local cache for sobjects
        let sobjectCache = settingsUtil.getSobjectsCache();
        let { sobjects, parentRelationships } = sobjectCache;
        if (!sobjects || !parentRelationships) {
            return [];
        }

        // Completion for Namespace
        if (pos.char === ".") {
            // parent relationship completion
            if (parentRelationships[pos.word]) {
                let sobjectNames = parentRelationships[pos.word];
                completionItems.push(...util.getFieldCompletionItem(sobjectNames));
            }

            // Sobject fields and relationships completion
            if (sobjects[pos.word.toLowerCase()]) {
                let sobjectName = sobjects[pos.word.toLowerCase()];
                completionItems.push(...util.getFieldCompletionItem([sobjectName]));
            }

            // Sobject instance fields and relationship completion
            let variableType = util.getVariableType(pos);
            if (sobjects[variableType.toLowerCase()]) {
                let sobjectName = sobjects[variableType.toLowerCase()];
                completionItems.push(...util.getFieldCompletionItem([sobjectName]));
            }
        }
        else if (pos.char === "=") {
            
        }
        // Add keyword completion
        else {
            for (const sobjectName of _.values(sobjects)) {
                completionItems.push(createCompletionItem(
                    sobjectName, CompletionItemKind.Keyword
                ));
            }
        }

        return _.uniqBy(completionItems, "label");
    }
}