/** Audited template/settings claims and unique native seed-birth tokens. */
export type ArtifactOwnership = Record<string, true | string>;
/** Refuse tampered ownership; only the preset's recorded audit may establish it. */
export declare function verifiedArtifactOwnership(pmRoot: string, stored: Record<string, unknown>): Promise<ArtifactOwnership>;
/** Reject an unowned collision even if its bytes happen to match the desired artifact. */
export declare function requireArtifactOwnership(owned: ArtifactOwnership, artifact: string): void;
/** Initialize the baseline through the same host serializer that initializes real trackers. */
export declare function initialPresetSettings(): Promise<Record<string, unknown>>;
/** Check every changed/deleted settings leaf, including raw keys removed by replacement. */
export declare function admitSettingsOwnership(before: Record<string, unknown>, after: Record<string, unknown>, owned: ArtifactOwnership, baseline?: Record<string, unknown>, keys?: readonly string[]): ArtifactOwnership;
/** Missing managed documents with retained identity require the public native restore command. */
export declare function refuseReservedSeedIdentity(pmRoot: string, id: string, owned: boolean): Promise<void>;
/** Match a native birth record to the unique token reserved before this run created the item. */
export declare function seedOwnershipProven(pmRoot: string, id: string, token: true | string | undefined): Promise<boolean>;
/** Recognize native identity races while leaving unrelated write failures in their own category. */
export declare function isArtifactCollision(error: unknown): boolean;
//# sourceMappingURL=artifact-ownership.d.ts.map