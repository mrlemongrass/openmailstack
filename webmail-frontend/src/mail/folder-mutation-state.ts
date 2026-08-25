export function remapFolderSubtreePath(
  folderPath: string,
  sourcePath: string,
  destinationPath: string,
  sourceDelimiter: string,
  destinationDelimiter = sourceDelimiter,
): string {
  if (folderPath === sourcePath) return destinationPath;
  if (sourceDelimiter && folderPath.startsWith(`${sourcePath}${sourceDelimiter}`)) {
    const descendantPath = folderPath.slice(sourcePath.length + sourceDelimiter.length);
    return `${destinationPath}${destinationDelimiter}${descendantPath
      .split(sourceDelimiter)
      .join(destinationDelimiter)}`;
  }
  return folderPath;
}

export function remapExpandedFolderPaths(
  expandedFolders: Record<string, boolean>,
  sourcePath: string,
  destinationPath: string,
  sourceDelimiter: string,
  destinationDelimiter = sourceDelimiter,
): Record<string, boolean> {
  return Object.fromEntries(Object.entries(expandedFolders).map(([folderPath, expanded]) => [
    remapFolderSubtreePath(
      folderPath,
      sourcePath,
      destinationPath,
      sourceDelimiter,
      destinationDelimiter,
    ),
    expanded,
  ]));
}

export function remapFavoriteFolderPaths(
  favoriteFolders: string[],
  sourcePath: string,
  destinationPath: string,
  sourceDelimiter: string,
  destinationDelimiter = sourceDelimiter,
): string[] {
  return [...new Set(favoriteFolders.map(folderPath => (
    remapFolderSubtreePath(
      folderPath,
      sourcePath,
      destinationPath,
      sourceDelimiter,
      destinationDelimiter,
    )
  )))];
}

export function removeFavoriteFolderSubtree(
  favoriteFolders: string[],
  sourcePath: string,
  delimiter: string,
): string[] {
  return favoriteFolders.filter(folderPath => (
    folderPath !== sourcePath
    && !(delimiter && folderPath.startsWith(`${sourcePath}${delimiter}`))
  ));
}
