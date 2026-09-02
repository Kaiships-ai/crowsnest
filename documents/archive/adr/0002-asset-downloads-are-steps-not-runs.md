# Asset downloads are Steps, not Runs

Status: accepted

The logs observability work makes syncs and remix stages first class Runs (things you watch, trace, cancel, retry, and hold to an SLA). Asset image downloads happen inside a Sync. We model each download as a Step of its Sync Run, not as a top level Run of its own, even though the grill answer asked for "everything runnable" as a Run. Making a download both a Step of a Sync and a standalone Run would give the same work two identities and a confusing parent child hierarchy in the UI and the trace.

The one exception: a download that Kai triggers by hand, outside any Sync (for example when eager download is off), is its own Run, because it has no parent Sync to be a Step of.

Consequence: the Run list shows syncs and remix stages, plus the rare standalone download. It never shows per image rows at the top level. Per image detail lives inside a Sync Run's timeline as Steps.
