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

export interface FavoriteFolderReferences {
  paths: string[];
  uidValidities: Record<string, string>;
}

export interface FavoriteFolderRenameCandidate {
  fromPath: string;
  toPath: string;
  uidValidity: string;
}

interface RemappedFavoriteReference {
  path: string;
  uidValidity?: string;
  remapped: boolean;
}

export function remapFavoriteFolderReferences(
  references: FavoriteFolderReferences,
  sourcePath: string,
  destinationPath: string,
  sourceDelimiter: string,
  destinationDelimiter = sourceDelimiter,
  eligiblePaths?: ReadonlySet<string>,
): FavoriteFolderReferences {
  const remappedReferences: RemappedFavoriteReference[] = [];
  const indexByPath = new Map<string, number>();

  for (const folderPath of references.paths) {
    const canRemap = !eligiblePaths || eligiblePaths.has(folderPath);
    const nextPath = canRemap ? remapFolderSubtreePath(
      folderPath,
      sourcePath,
      destinationPath,
      sourceDelimiter,
      destinationDelimiter,
    ) : folderPath;
    const remapped = nextPath !== folderPath;
    const uidValidity = Object.prototype.hasOwnProperty.call(references.uidValidities, folderPath)
      ? references.uidValidities[folderPath]
      : undefined;
    const existingIndex = indexByPath.get(nextPath);
    const nextReference = { path: nextPath, uidValidity, remapped };

    if (existingIndex === undefined) {
      indexByPath.set(nextPath, remappedReferences.length);
      remappedReferences.push(nextReference);
    } else if (remapped && !remappedReferences[existingIndex].remapped) {
      // A remapped source owns the destination identity when paths collide.
      remappedReferences[existingIndex] = nextReference;
    }
  }

  return {
    paths: remappedReferences.map(reference => reference.path),
    uidValidities: Object.fromEntries(remappedReferences.flatMap(reference => (
      typeof reference.uidValidity === 'string'
        ? [[reference.path, reference.uidValidity]]
        : []
    ))),
  };
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

export function removeFavoriteFolderReferences(
  references: FavoriteFolderReferences,
  sourcePath: string,
  delimiter: string,
  eligiblePaths?: ReadonlySet<string>,
): FavoriteFolderReferences {
  const paths = references.paths.filter(folderPath => {
    const belongsToRemovedTree = folderPath === sourcePath
      || Boolean(delimiter && folderPath.startsWith(`${sourcePath}${delimiter}`));
    return !belongsToRemovedTree || Boolean(eligiblePaths && !eligiblePaths.has(folderPath));
  });
  return {
    paths,
    uidValidities: Object.fromEntries(paths.flatMap(path => (
      Object.prototype.hasOwnProperty.call(references.uidValidities, path)
        ? [[path, references.uidValidities[path]]]
        : []
    ))),
  };
}

function normalizedUidValidity(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value.trim())) return '';
  const parsed = BigInt(value.trim());
  return parsed > 0n && parsed <= 4294967295n ? parsed.toString() : '';
}

export function reconcileFavoriteFolderReferences(
  references: FavoriteFolderReferences,
  folders: { path: string; uidValidity?: string; disabled?: boolean }[],
) {
  const selectableFolders = folders.filter(folder => !folder.disabled);
  const foldersByPath = new Map(selectableFolders.map(folder => [folder.path, folder]));
  const pathsByUidValidity = new Map<string, string[]>();
  for (const folder of selectableFolders) {
    const uidValidity = normalizedUidValidity(folder.uidValidity);
    if (!uidValidity) continue;
    const paths = pathsByUidValidity.get(uidValidity) || [];
    paths.push(folder.path);
    pathsByUidValidity.set(uidValidity, paths);
  }

  const visiblePaths: string[] = [];
  const nextIdentityEntries: [string, string][] = [];
  const renameCandidates: FavoriteFolderRenameCandidate[] = [];
  const unresolvedPaths: string[] = [];

  for (const favoritePath of references.paths) {
    const currentFolder = foldersByPath.get(favoritePath);
    const currentUidValidity = normalizedUidValidity(currentFolder?.uidValidity);
    const storedUidValidity = normalizedUidValidity(references.uidValidities[favoritePath]);

    if (currentFolder && (!storedUidValidity || !currentUidValidity || storedUidValidity === currentUidValidity)) {
      visiblePaths.push(favoritePath);
      const uidValidity = currentUidValidity || storedUidValidity;
      if (uidValidity) nextIdentityEntries.push([favoritePath, uidValidity]);
      continue;
    }

    if (storedUidValidity) nextIdentityEntries.push([favoritePath, storedUidValidity]);
    const candidates = storedUidValidity
      ? (pathsByUidValidity.get(storedUidValidity) || []).filter(path => path !== favoritePath)
      : [];
    if (candidates.length === 1) {
      renameCandidates.push({
        fromPath: favoritePath,
        toPath: candidates[0],
        uidValidity: storedUidValidity,
      });
    } else {
      unresolvedPaths.push(favoritePath);
    }
  }

  const nextIdentities = Object.fromEntries(nextIdentityEntries);

  return {
    references: {
      paths: [...references.paths],
      uidValidities: nextIdentities,
    },
    visiblePaths,
    renameCandidates,
    unresolvedPaths,
    unresolvedCount: unresolvedPaths.length,
    changed: JSON.stringify(nextIdentities) !== JSON.stringify(references.uidValidities),
  };
}
