import puppeteer from "puppeteer";

const url = process.env.APP_URL ?? "http://127.0.0.1:4200/";
const viewport = { width: 1600, height: 900 };

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector("ag-grid-angular.actions-grid", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));

  const metrics = await page.evaluate(() => {
    const actions = document.querySelector("ag-grid-angular.actions-grid");
    const results = document.querySelector("ag-grid-angular.results-grid");
    const actionsRoot = actions?.querySelector(".ag-root-wrapper");
    const resultsRoot = results?.querySelector(".ag-root-wrapper");
    const box = (el) => {
      if (!el) {
        return null;
      }
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
      };
    };
    return {
      viewportHeight: window.innerHeight,
      actionsHost: box(actions),
      actionsRoot: box(actionsRoot),
      resultsHost: box(results),
      resultsRoot: box(resultsRoot),
    };
  });

  const slack = 24;
  const failures = [];
  const check = (name, host, root) => {
    if (!host || !root) {
      failures.push(`${name}: missing from DOM`);
      return;
    }
    if (host.height < 200) {
      failures.push(`${name}: host height ${host.height} is too short`);
    }
    if (Math.abs(root.height - host.height) > slack) {
      failures.push(
        `${name}: inner grid ${root.height}px vs host ${host.height}px`,
      );
    }
    if (host.bottom > metrics.viewportHeight + slack) {
      failures.push(
        `${name}: bottom ${host.bottom} overflows viewport ${metrics.viewportHeight}`,
      );
    }
    if (metrics.viewportHeight - host.bottom > 80) {
      failures.push(
        `${name}: bottom ${host.bottom} leaves a ${metrics.viewportHeight - host.bottom}px gap to viewport ${metrics.viewportHeight}`,
      );
    }
  };

  check("actions", metrics.actionsHost, metrics.actionsRoot);
  check("results", metrics.resultsHost, metrics.resultsRoot);

  console.log(JSON.stringify(metrics, null, 2));
  if (failures.length) {
    console.error("LAYOUT CHECK FAILED:");
    for (const failure of failures) {
      console.error(" - " + failure);
    }
    process.exit(1);
  }
  console.log("LAYOUT CHECK PASSED");
} finally {
  await browser.close();
}
