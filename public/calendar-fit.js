// Keep the earliest weeks whose full content fits; always show at least one.
export function visibleWeekCount(weekHeights, availableHeight, gap) {
  let count = weekHeights.length;
  while (count > 1 && weekHeights.slice(0, count).reduce((sum, height) => sum + height, 0) + gap * (count - 1) > availableHeight) count--;
  return count;
}
