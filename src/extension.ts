import * as vscode from 'vscode';
import { ProviderResult, TextEditor } from 'vscode';
import * as prettier from 'prettier';
import * as t from '@babel/types';
import template from '@babel/template';

import fs from 'fs';

enum COMMANDS {
    DECLARE_UNDEFINED_COMPONENT = 'react-refactor-tool.declare-undefined-component',
}

export function getSelectedText() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const selection = editor.selection;
        return editor.document.getText(selection);
    } else {
        return null;
    }
}

export const parsingOptions = {
    plugins: [
        'objectRestSpread',
        'classProperties',
        'typescript',
        'jsx',
        'optionalChaining',
    ],
    sourceType: 'module',
} as any;

function getLinesCountWithPath(file: string): Promise<number> {
    return new Promise((resolve) => {
        let i;
        let count = 0;
        fs.createReadStream(file)
            .on('data', function (chunk) {
                for (i = 0; i < chunk.length; ++i) {
                    if (chunk[i] === 10) {
                        count++;
                    }
                }
            })
            .on('end', function () {
                resolve(count);
            });
    });
}

async function appendTextToCurrentActiveFile(
    editor: TextEditor,
    text: string
): Promise<void> {
    const linesCount = await getLinesCountWithPath(editor.document.fileName);

    editor.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(linesCount, 0), `\n${text}\n`);
    });
}

export class CodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): ProviderResult<vscode.CodeAction[]> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const currentPosition = editor.selection.active;

        const error = context.diagnostics.find((diagnostic) => {
            const range = diagnostic.range;
            return (
                currentPosition.isAfterOrEqual(range.start) &&
                currentPosition.isBeforeOrEqual(range.end)
            );
        });

        if (error && error.code === 2304) {
            const componentName = editor.document.getText(error.range);

            const isSelfClosingJSXElement = editor.document
                .getText()
                .match(new RegExp(`<(${componentName})([^>]*?)(\/{1})(\s*)?>`));

            let rangeOfJSXElement: vscode.Range;

            if (isSelfClosingJSXElement) {
                isSelfClosingJSXElement[0].length;
                rangeOfJSXElement = new vscode.Range(
                    editor.document.positionAt(
                        isSelfClosingJSXElement.index || 0
                    ),
                    editor.document.positionAt(
                        (isSelfClosingJSXElement.index || 0) +
                            isSelfClosingJSXElement[0].length
                    )
                );
            } else {
                rangeOfJSXElement = new vscode.Range(
                    editor.document.positionAt(
                        editor.document
                            .getText()
                            .match(new RegExp(`<${componentName}>`))?.index || 0
                    ),
                    editor.document.positionAt(
                        (editor.document
                            .getText()
                            .match(new RegExp(`<\/${componentName}>`))?.index ||
                            0) +
                            componentName.length +
                            3
                    )
                );
            }

            const targetJSXElementPlainText =
                editor.document.getText(rangeOfJSXElement);

            const ast: any = template.ast(
                targetJSXElementPlainText,
                parsingOptions
            );

            const title = 'Declare component with function declaration';
            const fixAction = new vscode.CodeAction(
                title,
                vscode.CodeActionKind.QuickFix
            );
            fixAction.diagnostics = [error];
            fixAction.command = {
                title,
                command: COMMANDS.DECLARE_UNDEFINED_COMPONENT,
                arguments: [componentName],
            };

            return t.isJSX(ast.expression) ? [fixAction] : [];
        }

        return [];
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            COMMANDS.DECLARE_UNDEFINED_COMPONENT,
            async (symbol) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }
                const appendText = await prettier.format(
                    `function ${symbol} (){ return(<></>) }`,
                    {
                        parser: 'babel',
                        semi: true,
                        singleQuote: true,
                        jsxSingleQuote: true,
                        trailingComma: 'es5',
                        bracketSpacing: true,
                        jsxBracketSameLine: false,
                        arrowParens: 'always',
                    }
                );

                appendTextToCurrentActiveFile(editor, appendText);
            }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            [
                { scheme: 'file', language: 'typescript' },
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'typescriptreact' },
                { scheme: 'file', language: 'javascriptreact' },
            ],
            new CodeActionProvider()
        )
    );
}

export function deactivate() {}
