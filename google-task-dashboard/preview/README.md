# Local dashboard preview

Runs the real `webhook/` frontend with a mocked backend and sample data.

## Usage

From `google-task-dashboard/`:

```sh
python preview/build.py
```

Open `preview/preview.html` in a browser. The chart needs internet access (Google Charts).
Rebuild and reload after changing anything in `webhook/` or `preview/mock.html`.

## Real data

In the storage spreadsheet, select the `Metrics` sheet and use File, Download, CSV. Load the
file with the controls panel. It is read in the browser only. Timestamps are shifted so the
newest row is "now". Do not commit the export.

## URL parameters

`?hour=22&date=2026-12-21&scenario=storm&scenery`

`?rows=N` sets the number of sample rows, spread evenly over the 75 days. The default is one
row per 3 hours (601 rows). Completed still grows by the scenario rate per day.

`?fail=name1,name2` makes those `google.script.run` calls invoke the failure handler with
`Error('Simulated failure: <name>')` instead of the success handler, for example
`?fail=getDashboardData,setTriggerEnabled`.
