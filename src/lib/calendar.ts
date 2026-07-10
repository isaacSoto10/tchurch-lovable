export function toCalendarQueryDate(value: Date) {
  if (Number.isNaN(value.getTime())) throw new Error("Invalid calendar date");

  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
