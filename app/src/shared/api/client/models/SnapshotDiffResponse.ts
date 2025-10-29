/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DocumentDiffResult } from './DocumentDiffResult';
import type { SnapshotDiffBaseResponse } from './SnapshotDiffBaseResponse';
import type { SnapshotSummary } from './SnapshotSummary';
export type SnapshotDiffResponse = {
    base: SnapshotDiffBaseResponse;
    diff: DocumentDiffResult;
    target: SnapshotSummary;
    target_markdown: string;
};

