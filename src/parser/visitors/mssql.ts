
import Lexer from '../lexer';
import { SQLLang, type SqlOptions } from "./types";
import { Visitor } from "./visitor";

export class MsSqlVisitor extends Visitor {
    constructor(options = <SqlOptions>{}, ast: Lexer.Token) {
        super({ ...options, type: SQLLang.MsSql }, ast);
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];

        switch (method) {
            case "indexof":
                this[target] += `(CHARINDEX(`;
                this.Visit(params[1], context); // substring
                this[target] += ", ";
                this.Visit(params[0], context); // string
                this[target] += `) - 1)`;
                break;
            default:
                super.VisitMethodCallExpression(node, context);
                break;
        }
    }
}
