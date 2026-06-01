type StatsStripProps = {
  offline: boolean;
  nodes?: number;
  links?: number;
  scaleMode: string;
  formatNumber: (value?: number) => string;
};

export function StatsStrip({ offline, nodes, links, scaleMode, formatNumber }: StatsStripProps) {
  return (
    <section className={`stats-strip ${offline ? "offline" : ""}`} aria-label="Graph totals">
      {offline ? (
        <>
          <strong>Service</strong>
          <span>offline</span>
        </>
      ) : (
        <>
          <strong>{formatNumber(nodes)}</strong>
          <span>atlas points</span>
          <strong>{formatNumber(links)}</strong>
          <span>atlas links</span>
          {scaleMode ? <em>{scaleMode}</em> : null}
        </>
      )}
    </section>
  );
}
