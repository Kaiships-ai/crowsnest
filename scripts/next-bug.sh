#!/usr/bin/env bash
# next-bug.sh: open backlog bugs (GitHub issues labeled `backlog`), highest severity first.
# Severity and type come from the issue body ("Severity: x. Type: bug."). First line is the next bug to fix.
set -uo pipefail
gh issue list --label backlog --state open --limit 200 --json number,title,labels,body --jq '
  def sev: (.body | capture("Severity: (?<s>[a-z]+)\\.").s? // "low");
  [.[] | select(.body | test("Type: bug\\.")) | {n: .number, sev: sev, t: .title,
     a: ([.labels[].name | select(startswith("area:"))] | first // "")}]
  | sort_by({"blocker":0,"high":1,"medium":2,"low":3}[.sev] // 4)
  | .[] | "#\(.n)\t\(.sev)\t\(.a)\t\(.t)"'
