export function remapFolderSubtreePath(
  folderPath: string,
  sourcePath: string,
  destinationPath: string,
  delimiter: string,
): string {
  if (folderPath === sourcePath) return destinationPath;
  if (delimiter && folderPath.startsWith(`${sourcePath}${delimiter}`)) {
    return `${destinationPath}${folderPath.slice(sourcePath.length)}`;
  }
  return folderPath;
}

export function remapExpandedFolderPaths(
  expandedFolders: Record<string, boolean>,
  sourcePath: string,
  destinationPath: string,
  delimiter: string,
): Record<string, boolean> {
  return Object.fromEntries(Object.entries(expandedFolders).map(([folderPath, expanded]) => [
    remapFolderSubtreePath(folderPath, sourcePath, destinationPath, delimiter),
    expanded,
  ]));
}
