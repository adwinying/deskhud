// Lucide SVGs are 24px; 1em makes them follow the surrounding text size.
export const icon = (svg: string) =>
  svg.replace("<svg", '<svg aria-hidden="true"').replaceAll('="24"', '="1em"')
