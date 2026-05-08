# Stack Options

Drop-in setup prompts for optional technology choices. Run one of these prompts
in a new project to install, configure, and document a library according to the
template's conventions.

Each prompt is self-contained — it installs packages, creates hooks/components,
updates CLAUDE.md, and writes docs. Run it once at project setup, not ongoing.

## Available

| File                                   | What it sets up                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [echarts.md](echarts.md)               | Apache ECharts for data visualisation (Sankey, sunburst, chord, clustering, etc.)                                |
| [data-warehouse.md](data-warehouse.md) | BigQuery + dbt data pipeline, data quality conventions, data-engineer subagent, optional Cube.dev semantic layer |

## How to use

Copy the content of the relevant file and run it as a prompt in your new project.
