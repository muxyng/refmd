/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DocumentDiffLine } from './DocumentDiffLine';
export type DocumentDiffResult = {
    diff_lines: Array<DocumentDiffLine>;
    file_path: string;
    new_content?: string | null;
    old_content?: string | null;
};

