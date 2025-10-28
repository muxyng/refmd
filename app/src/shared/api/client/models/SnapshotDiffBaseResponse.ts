/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SnapshotDiffKind } from './SnapshotDiffKind';
import type { SnapshotSummary } from './SnapshotSummary';
export type SnapshotDiffBaseResponse = {
    kind: SnapshotDiffKind;
    markdown: string;
    snapshot?: SnapshotSummary | null;
};

