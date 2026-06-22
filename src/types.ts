import { Visitor } from './parser/visitor';

export interface ParsedQuery {
    select?: string;
    where?: string;
    orderby?: string;
    groupby?: string;
    limit?: number;
    skip?: number;
    includes?: Visitor[];
    format?: string;
    count?: boolean;
    skipToken?: string;
    search?: string;
    parameters?: Map<string, any>;
}
