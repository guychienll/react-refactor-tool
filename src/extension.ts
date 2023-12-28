import template, { TemplateBuilderOptions } from '@babel/template';
import * as t from '@babel/types';
import * as prettier from 'prettier';
import * as vscode from 'vscode';
import { ProviderResult, TextEditor } from 'vscode';
import fs from 'fs';

const SUPPORT_LANGUAGES = [
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'typescriptreact' },
    { scheme: 'file', language: 'javascriptreact' },
];

enum COMMANDS {
    DECLARE_UNDEFINED_COMPONENT = 'react-refactor-tool.declare-undefined-component',
}

const PRETTIER_OPTIONS = {
    parser: 'babel',
    semi: true,
    singleQuote: true,
    jsxSingleQuote: true,
    trailingComma: 'es5',
    bracketSpacing: true,
    jsxBracketSameLine: false,
    arrowParens: 'always',
} as prettier.Options;

export const BABEL_PARSING_OPTIONS = {
    plugins: [
        'objectRestSpread',
        'classProperties',
        'typescript',
        'jsx',
        'optionalChaining',
    ],
    sourceType: 'module',
} as TemplateBuilderOptions;

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

            const range = this.getRangeOfJSXElement(document, componentName);

            if (!range) {
                return;
            }

            const targetJSXElementPlainText = editor.document.getText(range);

            const ast: any = template.ast(
                targetJSXElementPlainText,
                BABEL_PARSING_OPTIONS
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

    private getRangeOfJSXElement(
        document: vscode.TextDocument,
        componentName: string
    ) {
        let rangeOfJSXElement: vscode.Range | null = null;

        const selfClosingJSXElementMatchObject = document
            .getText()
            .match(new RegExp(`<(${componentName})([^>]*?)(\/{1})(\\s*)?>`));

        if (selfClosingJSXElementMatchObject) {
            selfClosingJSXElementMatchObject[0].length;
            rangeOfJSXElement = new vscode.Range(
                document.positionAt(
                    selfClosingJSXElementMatchObject.index || 0
                ),
                document.positionAt(
                    (selfClosingJSXElementMatchObject.index || 0) +
                        selfClosingJSXElementMatchObject[0].length
                )
            );
        } else {
            const startMatchObject = document
                .getText()
                .match(new RegExp(`<(\\s*)${componentName}(\\s*)>`));
            const endMatchObject = document
                .getText()
                .match(new RegExp(`<\/(\\s*)${componentName}(\\s*)>`));

            if (!startMatchObject || !endMatchObject) {
                return rangeOfJSXElement;
            }

            rangeOfJSXElement = new vscode.Range(
                document.positionAt(startMatchObject.index || 0),
                document.positionAt(
                    (endMatchObject.index || 0) + endMatchObject[0].length
                )
            );
        }
        return rangeOfJSXElement;
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
                    `function ${symbol} (){ return null }`,
                    PRETTIER_OPTIONS
                );

                appendTextToCurrentActiveFile(editor, appendText);
            }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            SUPPORT_LANGUAGES,
            new CodeActionProvider()
        )
    );
}

export function deactivate() {}
