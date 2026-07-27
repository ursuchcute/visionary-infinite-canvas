export const CURRENT_HOSTED_BUILD_METADATA_VERSION = 1;

export function hostedBuildMetadataVersion(manifest) {
    if (!manifest || !Object.prototype.hasOwnProperty.call(manifest, "buildMetadataVersion")) return 0;
    const version = manifest.buildMetadataVersion;
    return typeof version === "number" && Number.isInteger(version) && version === CURRENT_HOSTED_BUILD_METADATA_VERSION ? version : Number.NaN;
}

export function requiresCurrentHostedContract(manifest) {
    return hostedBuildMetadataVersion(manifest) >= CURRENT_HOSTED_BUILD_METADATA_VERSION;
}
