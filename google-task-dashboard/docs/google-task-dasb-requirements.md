# Requirements for Google task dashboard

## Purpose

Should ingest google tasks on a regular basis (e.g. every 2 hours). Store the
metrics in a Google sheet as the storage backend. Provide a website where the
metrics can be viewed as time series.

The user shall be able to see a trend of tasks that are open, done, overdue, ...

## Components

* apps script: gets triggered by a timed trigger (e.g. every 3 hours). it reads
  the tasks, calculate metrics and updates a specific google sheet with a time
  stamp
* google sheet: serves as a storage, no special logic attached
* HTML component: serves an HTML site with a dashboard that reads data from the
  Google sheet and then plots the data. if possible contains interactive
  elements like filters.

## Auth model

Since its for personal use, very simple: apps script gets access to tasks. The
HTML app can be viewed by my personal account (device needs to be logged in to
google account). The deployment address is random, this adds to security, but we
rely on the Google auth for access.

## Technical requirements

### apps script

TODO

### sheet

TODO

### HTML component

TODO
