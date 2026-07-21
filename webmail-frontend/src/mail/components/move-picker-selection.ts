export function selectMoveDestination(
  folderPath: string,
  onMove: (folderPath: string) => void,
  onClose: () => void,
) {
  onMove(folderPath);
  onClose();
}
