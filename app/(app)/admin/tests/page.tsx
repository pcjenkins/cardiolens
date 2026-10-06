import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getTestReport, shortPath } from "@/lib/test-report";

export const metadata = { title: "Test results | CardioLens" };

export default async function TestResultsPage() {
  const session = await verifySession();
  if (session.role !== "admin") notFound();

  const { results, coverage } = getTestReport();

  if (!results) {
    return (
      <section className="card">
        <h1>Release test results</h1>
        <p>No test report found. Run <code>npm run test:report</code> (or setup.bat), then refresh.</p>
      </section>
    );
  }

  return (
    <>
      <p><Link href="/admin">← Admin</Link></p>

      <section className="card">
        <h1>Release test results</h1>
        <p className="muted">Run at {new Date(results.startTime).toLocaleString()}</p>
        <p>
          <span className={`badge ${results.success ? "" : "bad"}`}>{results.success ? "PASSED" : "FAILED"}</span>{" "}
          {results.numPassedTests} passed · {results.numFailedTests} failed · {results.numPendingTests} skipped
          · {results.numTotalTests} total
        </p>
      </section>

      {results.testResults.map((file) => (
        <section className="card table-wrap" key={file.name}>
          <h2>{shortPath(file.name)}</h2>
          <table>
            <thead><tr><th>Test</th><th>Status</th><th className="num">ms</th></tr></thead>
            <tbody>
              {file.assertionResults.map((t, i) => (
                <tr key={i}>
                  <td>{[...t.ancestorTitles, t.title].join(" › ")}</td>
                  <td><span className={`badge ${t.status === "passed" ? "" : "bad"}`}>{t.status}</span></td>
                  <td className="num">{t.duration ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {coverage && (
        <section className="card table-wrap">
          <h2>Coverage</h2>
          <table>
            <thead><tr><th>File</th><th className="num">Lines</th><th className="num">Branches</th><th className="num">Functions</th></tr></thead>
            <tbody>
              {Object.entries(coverage).map(([file, c]) => (
                <tr key={file}>
                  <td>{file === "total" ? <strong>Total</strong> : shortPath(file)}</td>
                  <td className="num">{c.lines.pct}%</td>
                  <td className="num">{c.branches.pct}%</td>
                  <td className="num">{c.functions.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}