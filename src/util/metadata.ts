import { Surreal } from 'surrealdb';
import { ODataExpressTable } from '../types';

// Create function to get the odatav4 metadata for a table
// create function to get JSON schema for a table

interface ODataProperty {
    $Type: string;
    $Nullable?: boolean;
    $Collection?: boolean;
    $MaxLength?: number;
}

interface ODataEntityType {
    $Kind: 'EntityType';
    $Key: string[];
    [propertyName: string]: ODataProperty | any;
}

interface ODataEntitySet {
    $Collection: string;
    $Type: string;
}

interface ODataSchema {
    $Version: '4.0';
    $EntityContainer: string;
    [entityTypeName: string]: ODataEntityType | any;
}

interface ODataMetadata {
    $Version: '4.0';
    $EntityContainer: {
        // $Kind: 'EntityContainer';
    } & Record<string, ODataEntitySet>;
    [schemaName: string]: ODataSchema | any;
}

/**
 * Generate OData V4 Metadata for a given ODataExpressTable based on its SurrealDB table structure.
 * @param db SurrealDB instance
 * @param table ODataExpressTable configuration
 * @returns OData Metadata object
 */
export const getODataMetadata = async (db: Surreal, table: ODataExpressTable<any>) => {
    const [{ fields }] = await db.query(`INFO FOR TABLE \`${table.table.replace(/`/g, '\\`')}\``).collect<[{ fields: { [key: string]: string; }; }]>();

    const entityTypeName = `core.${table.table}`;
    const entityType: ODataEntityType = {
        $Kind: 'EntityType',
        $Key: ['id']
    };

    Object.entries(fields).forEach(([field, info]) => {
        const typeMatch = info.match(/TYPE (?<typeString>.+?)(?:\s+(?:READONLY|PERMISSIONS|DEFAULT|VALUE|ASSERT)|$)/);
        const typeString = typeMatch?.groups?.typeString || 'any';

        const processTypeToOData = (typeStr: string): { type: string; nullable: boolean; collection: boolean; maxLength?: number } => {
            let nullable = false;
            let collection = false;
            let maxLength: number | undefined;

            // Handle option<> wrapper (nullable)
            if (typeStr.startsWith('option<') && typeStr.endsWith('>')) {
                nullable = true;
                typeStr = typeStr.slice(7, -1);
            }

            // Handle array<> wrapper (collection)
            if (typeStr.startsWith('array<') && typeStr.endsWith('>')) {
                collection = true;
                typeStr = typeStr.slice(6, -1);
            }

            // Handle record<> wrapper
            if (typeStr.startsWith('record<') && typeStr.endsWith('>')) {
                const recordType = typeStr.slice(7, -1);
                if (recordType && recordType !== 'any') {
                    return { type: `${recordType}`, nullable, collection };
                }
                return { type: 'Edm.String', nullable, collection };
            }

            // Handle string with length constraint
            const stringLengthMatch = typeStr.match(/^string\((\d+)\)$/);
            if (stringLengthMatch) {
                maxLength = parseInt(stringLengthMatch[1]);
                typeStr = 'string';
            }

            // Map SurrealDB types to OData EDM types
            let edmType: string;
            switch (typeStr) {
                case 'string':
                    edmType = 'Edm.String';
                    break;
                case 'int':
                    edmType = 'Edm.Int64';
                    break;
                case 'float':
                    edmType = 'Edm.Double';
                    break;
                case 'bool':
                    edmType = 'Edm.Boolean';
                    break;
                case 'datetime':
                    edmType = 'Edm.DateTimeOffset';
                    break;
                case 'duration':
                    edmType = 'Edm.Duration';
                    break;
                case 'bytes':
                    edmType = 'Edm.Binary';
                    break;
                case 'uuid':
                    edmType = 'Edm.Guid';
                    break;
                case 'decimal':
                    edmType = 'Edm.Decimal';
                    break;
                case 'geojson':
                case 'object':
                    edmType = 'Edm.String'; // Complex objects as JSON strings
                    break;
                case 'record':
                case 'table':
                    edmType = 'Edm.String';
                    break;
                default:
                    edmType = 'Edm.String';
            }

            return { type: edmType, nullable, collection, maxLength };
        };

        const { type, nullable, collection, maxLength } = processTypeToOData(typeString);

        const property: ODataProperty = {
            $Type: type
        };

        if (nullable) {
            property.$Nullable = true;
        }

        if (collection) {
            property.$Collection = true;
        }

        if (maxLength !== undefined) {
            property.$MaxLength = maxLength;
        }

        entityType[field] = property;
    });

    // Build the complete OData metadata document
    const metadata: ODataMetadata = {
        $Version: '4.0',
        $EntityContainer: {
            // $Kind: 'EntityContainer',
            [table.table]: {
                $Collection: entityTypeName,
                $Type: entityTypeName
            }
        },
        ['core']: {
            $Version: '4.0',
            $EntityContainer: `Container`,
            [table.table]: entityType
        }
    };

    return metadata;
};

interface JSONSchemaProperty {
    type?: string | string[];
    format?: string;
    items?: JSONSchemaProperty;
    properties?: Record<string, JSONSchemaProperty>;
    additionalProperties?: boolean | JSONSchemaProperty;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    enum?: any[];
    required?: string[];
}

interface JSONSchema {
    $schema: string;
    $id?: string;
    title?: string;
    type: string;
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
}

/**
 * Generate JSON Schema for a given ODataExpressTable based on its SurrealDB table structure.
 * @param db SurrealDB instance
 * @param table ODataExpressTable configuration
 * @returns JSON Schema object
 */
export const getJSONSchema = async (db: Surreal, table: ODataExpressTable<any>): Promise<JSONSchema> => {
    const [{ fields }] = await db.query(`INFO FOR TABLE \`${table.table.replace(/`/g, '\\`')}\``).collect<[{ fields: { [key: string]: string; }; }]>();

    const properties: Record<string, JSONSchemaProperty> = {};
    const required: string[] = [];

    Object.entries(fields).forEach(([field, info]) => {
        const typeMatch = info.match(/TYPE (?<typeString>.+?)(?:\s+(?:READONLY|PERMISSIONS|DEFAULT|VALUE|ASSERT)|$)/);
        const typeString = typeMatch?.groups?.typeString || 'any';

        const processTypeToJSONSchema = (typeStr: string): JSONSchemaProperty => {
            // let isOptional = false;

            // Handle option<> wrapper (nullable/optional)
            if (typeStr.startsWith('option<') && typeStr.endsWith('>')) {
                // isOptional = true;
                typeStr = typeStr.slice(7, -1);
            }

            // Handle array<> wrapper
            if (typeStr.startsWith('array<') && typeStr.endsWith('>')) {
                const itemType = typeStr.slice(6, -1);
                return {
                    type: 'array',
                    items: processTypeToJSONSchema(itemType)
                };
            }

            // Handle record<> wrapper
            if (typeStr.startsWith('record<') && typeStr.endsWith('>')) {
                const recordType = typeStr.slice(7, -1);
                if (recordType && recordType !== 'any') {
                    return {
                        type: 'string',
                        format: 'uri-reference',
                        pattern: `^${recordType}:`
                    };
                }
                return { type: 'string', format: 'uri-reference' };
            }

            // Handle string with length constraint
            const stringLengthMatch = typeStr.match(/^string\((\d+)\)$/);
            if (stringLengthMatch) {
                return {
                    type: 'string',
                    maxLength: parseInt(stringLengthMatch[1])
                };
            }

            // Handle number ranges
            const numberRangeMatch = typeStr.match(/^(int|float)\((-?\d+)\.\.(-?\d+)\)$/);
            if (numberRangeMatch) {
                const [, numType, min, max] = numberRangeMatch;
                return {
                    type: numType === 'int' ? 'integer' : 'number',
                    minimum: parseInt(min),
                    maximum: parseInt(max)
                };
            }

            // Map SurrealDB types to JSON Schema types
            switch (typeStr) {
                case 'string':
                    return { type: 'string' };
                case 'int':
                    return { type: 'integer' };
                case 'float':
                case 'decimal':
                    return { type: 'number' };
                case 'bool':
                    return { type: 'boolean' };
                case 'datetime':
                    return {
                        type: 'string',
                        format: 'date-time'
                    };
                case 'duration':
                    return {
                        type: 'string',
                        format: 'duration'
                    };
                case 'bytes':
                    return {
                        type: 'string',
                        format: 'binary'
                    };
                case 'uuid':
                    return {
                        type: 'string',
                        format: 'uuid'
                    };
                case 'geojson':
                    return {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            coordinates: { type: 'array' }
                        },
                        required: ['type', 'coordinates'],
                        additionalProperties: true
                    };
                case 'object':
                    return {
                        type: 'object',
                        additionalProperties: true
                    };
                case 'record':
                case 'table':
                    return {
                        type: 'string',
                        format: 'uri-reference'
                    };
                case 'any':
                case 'value':
                    return {}; // No type restriction
                default:
                    return { type: 'string' };
            }
        };

        const property = processTypeToJSONSchema(typeString);
        properties[field] = property;

        // If the field is not optional, add it to required array
        if (!typeString.startsWith('option<')) {
            required.push(field);
        }
    });

    const schema: JSONSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `#/${table.table}`,
        title: `${table.table} Schema`,
        type: 'object',
        properties,
        additionalProperties: false
    };

    if (required.length > 0) {
        schema.required = required;
    }

    return schema;
};
