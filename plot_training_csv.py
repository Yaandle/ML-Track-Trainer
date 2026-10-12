
#!/usr/bin/env python3
"""
Panorama Lab CSV Graph Generator

Reads training CSV data and generates minimalist PNG graphs.

Usage:
    python plot_training_csv.py training.csv
    python plot_training_csv.py training.csv --metric reward
    python plot_training_csv.py training.csv --metric termination
    python plot_training_csv.py training.csv --metric completion
    python plot_training_csv.py training.csv --metric reward_components
    python plot_training_csv.py training.csv --metric progress_pct --group generation
    python plot_training_csv.py training.csv --all
    python plot_training_csv.py training.csv --list-metrics

Dependencies:
    python -m pip install pandas matplotlib
"""

import argparse
import re
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.ticker import MaxNLocator


# --------------------------------------------------
# Visual style
# --------------------------------------------------

BG = "#FEFEFE"
INK = "#2A2A2A"
RED = "#D64545"
MUTED = "#777777"
GRID = "#E8E8E8"
GREY = "#A9A9A9"

METRICS = {
    "reward": ("Reward", "Reward"),
    "generation": ("Generation", "Generation"),
    "progress_pct": ("Progress", "Progress (%)"),
    "elapsed_s": ("Elapsed time", "Elapsed time (s)"),
    "lap_time_s": ("Lap time", "Lap time (s)"),
    "r_progress": ("Progress reward", "Reward contribution"),
    "r_time": ("Time penalty", "Reward contribution"),
    "r_grass": ("Off-road penalty", "Reward contribution"),
    "r_terminal": ("Terminal reward", "Reward contribution"),
    "offroad_s": ("Off-road time", "Off-road time (s)"),
    "driver_id": ("Driver ID", "Driver ID"),
    "seed": ("Seed", "Seed"),
}


def configure_style():
    """Apply the shared minimalist graph style."""
    plt.rcParams.update({
        "figure.facecolor": BG,
        "axes.facecolor": BG,
        "savefig.facecolor": BG,
        "text.color": INK,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "axes.titlesize": 14,
        "axes.titleweight": "medium",
        "axes.labelsize": 10,
        "axes.edgecolor": GRID,
        "axes.linewidth": 0.8,
        "axes.grid": True,
        "grid.color": GRID,
        "grid.linewidth": 0.7,
        "grid.alpha": 1.0,
        "xtick.major.size": 0,
        "ytick.major.size": 0,
        "legend.frameon": False,
        "figure.dpi": 130,
        "savefig.dpi": 220,
    })


def clean_name(value):
    """Convert a metric name into a safe filename."""
    return re.sub(
        r"[^a-zA-Z0-9_-]+", "_", value
    ).strip("_").lower()


def finish_axes(ax, title, xlabel, ylabel):
    """Apply consistent labels and remove unnecessary borders."""
    ax.set_title(title, loc="left", pad=14)
    ax.set_xlabel(xlabel, labelpad=8)
    ax.set_ylabel(ylabel, labelpad=8)

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(GRID)
    ax.spines["bottom"].set_color(GRID)

    ax.grid(axis="x", visible=False)
    ax.set_axisbelow(True)


def save_figure(fig, output):
    """Save a high-resolution graph and close its figure."""
    output.parent.mkdir(parents=True, exist_ok=True)

    fig.savefig(
        output,
        dpi=220,
        bbox_inches="tight",
        pad_inches=0.25,
    )

    plt.close(fig)
    print(f"Saved: {output}")


# --------------------------------------------------
# CSV loading
# --------------------------------------------------

def load_csv(path):
    """Read the CSV and convert recognised fields to numbers."""
    try:
        df = pd.read_csv(path, skipinitialspace=True)
    except Exception as exc:
        raise SystemExit(f"Could not read CSV: {exc}")

    df.columns = [str(column).strip() for column in df.columns]

    if df.empty:
        raise SystemExit("The CSV contains no data rows.")

    for column in list(METRICS) + ["lap_completed"]:
        if column in df.columns:
            df[column] = pd.to_numeric(
                df[column], errors="coerce"
            )

    return df


def available_metrics(df):
    """Return numeric columns that contain usable data."""
    return [
        column
        for column in METRICS
        if column in df.columns
        and df[column].notna().any()
    ]


# --------------------------------------------------
# Numeric graphs
# --------------------------------------------------

def plot_numeric(df, metric, output, group=None):
    """Plot a numeric metric, optionally grouped by another column."""
    if metric not in df.columns:
        print(f"Skipping {metric}: column not found.")
        return False

    data = df.copy()
    data[metric] = pd.to_numeric(data[metric], errors="coerce")
    data = data.dropna(subset=[metric])

    if data.empty:
        print(f"Skipping {metric}: no numeric data.")
        return False

    title, ylabel = METRICS.get(
        metric,
        (metric.replace("_", " ").title(), metric),
    )

    fig, ax = plt.subplots(figsize=(8.4, 4.8))

    # Grouped summary: useful for tracking training by generation.
    if group and group in data.columns and group != metric:
        data[group] = pd.to_numeric(
            data[group], errors="coerce"
        )
        data = data.dropna(subset=[group])

        if data.empty:
            plt.close(fig)
            print(f"Skipping {metric}: no usable group values.")
            return False

        summary = data.groupby(group)[metric].agg(
            ["median", "mean", "max", "count"]
        ).sort_index()

        x = summary.index.to_numpy()

        ax.plot(
            x, summary["median"],
            color=RED, linewidth=2.2, label="Median",
        )
        ax.plot(
            x, summary["mean"],
            color=INK, linewidth=1.5,
            linestyle="--", label="Mean",
        )

        ax.scatter(
            x, summary["median"],
            color=RED, s=18, zorder=3,
        )

        ax.legend(loc="best")

        group_label = group.replace("_", " ").title()
        title = f"{title} by {group_label.lower()}"
        xlabel = group_label

        if len(summary) <= 20:
            ax.xaxis.set_major_locator(
                MaxNLocator(integer=True, nbins=10)
            )

    # Reward is particularly useful against generation.
    elif (
        metric == "reward"
        and "generation" in data.columns
        and data["generation"].nunique() > 1
    ):
        data = data.sort_values("generation")

        summary = data.groupby("generation")["reward"].agg(
            ["mean", "median", "max"]
        )

        ax.scatter(
            data["generation"], data["reward"],
            color=GREY, s=14, alpha=0.55,
            edgecolors="none", label="Driver reward",
        )

        ax.plot(
            summary.index, summary["max"],
            color=RED, linewidth=2.2,
            label="Best reward",
        )

        ax.plot(
            summary.index, summary["mean"],
            color=INK, linewidth=1.5,
            linestyle="--", label="Mean reward",
        )

        ax.legend(loc="best")
        xlabel = "Generation"

    # Default: plot values by CSV row.
    else:
        data = data.reset_index(drop=True)
        x = range(1, len(data) + 1)

        ax.scatter(
            x, data[metric],
            color=RED, s=20, alpha=0.85,
            edgecolors="none",
        )

        xlabel = "CSV row"

    if len(data) == 1:
        ax.text(
            0.98, 0.95,
            f"n = 1 | value = {data[metric].iloc[0]:,.3g}",
            transform=ax.transAxes,
            ha="right", va="top",
            color=MUTED, fontsize=9,
        )

    finish_axes(ax, title, xlabel, ylabel)
    fig.tight_layout()
    save_figure(fig, output)

    return True


# --------------------------------------------------
# Termination graph
# --------------------------------------------------

def plot_termination(df, output):
    """Show how episodes ended: wall, stall, lap, timeout, etc."""
    if "termination" not in df.columns:
        print("Skipping termination: column not found.")
        return False

    reasons = (
        df["termination"]
        .fillna("unknown")
        .astype(str)
        .str.strip()
        .replace("", "unknown")
        .value_counts()
        .sort_values()
    )

    if reasons.empty:
        return False

    fig, ax = plt.subplots(
        figsize=(7.4, max(3.4, 0.65 * len(reasons) + 1.3))
    )

    bars = ax.barh(
        reasons.index,
        reasons.values,
        color=INK,
        height=0.58,
    )

    for index, reason in enumerate(reasons.index):
        if reason == "wall":
            bars[index].set_color(RED)

    for bar, value in zip(bars, reasons.values):
        ax.text(
            value + max(reasons.max() * 0.02, 0.05),
            bar.get_y() + bar.get_height() / 2,
            str(value),
            va="center",
            fontsize=9,
            color=INK,
        )

    ax.set_xlim(0, max(reasons.max() * 1.15, 1))

    finish_axes(
        ax,
        "Episode termination reasons",
        "Number of drivers",
        "Termination",
    )

    fig.tight_layout()
    save_figure(fig, output)
    return True


# --------------------------------------------------
# Lap completion graph
# --------------------------------------------------

def plot_completion(df, output):
    """Compare completed laps with unfinished episodes."""
    if "lap_completed" not in df.columns:
        print("Skipping completion: column not found.")
        return False

    completed = pd.to_numeric(
        df["lap_completed"], errors="coerce"
    ).dropna()

    if completed.empty:
        print("Skipping completion: no usable values.")
        return False

    finished = int((completed == 1).sum())
    unfinished = int(len(completed) - finished)
    total = len(completed)
    rate = 100 * finished / total

    fig, ax = plt.subplots(figsize=(6.6, 4.2))

    bars = ax.bar(
        ["Completed", "Not completed"],
        [finished, unfinished],
        color=[RED, GREY],
        width=0.52,
    )

    for bar, value in zip(bars, [finished, unfinished]):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + max(total * 0.025, 0.05),
            str(value),
            ha="center",
            va="bottom",
            color=INK,
            fontsize=10,
        )

    ax.set_ylim(0, max(total * 1.2, 1))

    ax.text(
        0.98, 0.95,
        f"{rate:.1f}% completed | n = {total}",
        transform=ax.transAxes,
        ha="right",
        va="top",
        color=MUTED,
        fontsize=9,
    )

    finish_axes(
        ax,
        "Lap completion",
        "Outcome",
        "Number of drivers",
    )

    fig.tight_layout()
    save_figure(fig, output)
    return True


# --------------------------------------------------
# Reward component graph
# --------------------------------------------------

def plot_reward_components(df, output):
    """Compare the mean contribution of each reward component."""
    columns = [
        column
        for column in (
            "r_progress",
            "r_time",
            "r_grass",
            "r_terminal",
        )
        if column in df.columns
    ]

    if not columns:
        print("Skipping reward components: columns not found.")
        return False

    values = df[columns].apply(
        pd.to_numeric, errors="coerce"
    ).mean().dropna()

    if values.empty:
        return False

    labels = {
        "r_progress": "Progress",
        "r_time": "Time",
        "r_grass": "Off-road",
        "r_terminal": "Terminal",
    }

    values = values.sort_values()

    fig, ax = plt.subplots(figsize=(7.6, 4.6))

    colors = [
        RED if key == "r_terminal"
        else INK if value < 0
        else GREY
        for key, value in values.items()
    ]

    bars = ax.barh(
        [labels.get(key, key) for key in values.index],
        values.values,
        color=colors,
        height=0.58,
    )

    ax.axvline(0, color=MUTED, linewidth=0.8)

    maximum = max(abs(values).max(), 0.1)
    offset = maximum * 0.025

    for bar, value in zip(bars, values.values):
        ax.text(
            value + (offset if value >= 0 else -offset),
            bar.get_y() + bar.get_height() / 2,
            f"{value:+,.2f}",
            ha="left" if value >= 0 else "right",
            va="center",
            fontsize=9,
            color=INK,
        )

    finish_axes(
        ax,
        "Mean reward components per driver",
        "Mean reward contribution",
        "Component",
    )

    ax.grid(axis="y", visible=False)
    fig.tight_layout()
    save_figure(fig, output)
    return True


# --------------------------------------------------
# Main
# --------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Generate minimalist PNG graphs from training CSV data."
    )

    parser.add_argument(
        "csv",
        type=Path,
        help="Path to the training CSV file",
    )

    parser.add_argument(
        "--metric",
        choices=sorted(
            set(METRICS) |
            {"termination", "completion", "reward_components"}
        ),
        default="reward",
        help="Metric to graph (default: reward)",
    )

    parser.add_argument(
        "--group",
        help="Group a numeric metric by a column, e.g. generation",
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory for generated PNG files",
    )

    parser.add_argument(
        "--all",
        action="store_true",
        help="Generate a set of useful graphs",
    )

    parser.add_argument(
        "--list-metrics",
        action="store_true",
        help="List numeric columns with usable data",
    )

    args = parser.parse_args()
    csv_path = args.csv.expanduser()

    if not csv_path.is_file():
        print(f"CSV file not found: {csv_path}", file=sys.stderr)
        return 2

    df = load_csv(csv_path)
    configure_style()

    output_dir = args.output_dir or (csv_path.parent / "graphs")
    output_dir.mkdir(parents=True, exist_ok=True)

    metrics = available_metrics(df)

    if args.list_metrics:
        print("Numeric metrics with usable data:")

        for metric in metrics:
            count = df[metric].notna().sum()
            print(f"  {metric:16} {count:>6} valid rows")

        print(
            "\nSpecial graphs: termination, completion, reward_components"
        )
        return 0

    if args.all:
        generated = 0

        # Group by generation only when the CSV contains multiple generations.
        group = (
            "generation"
            if "generation" in df.columns
            and df["generation"].nunique() > 1
            else None
        )

        for metric in (
            "reward",
            "progress_pct",
            "elapsed_s",
            "lap_time_s",
            "offroad_s",
        ):
            metric_group = group if metric != "generation" else None

            generated += plot_numeric(
                df,
                metric,
                output_dir / f"{clean_name(metric)}.png",
                group=metric_group,
            )

        generated += plot_termination(
            df, output_dir / "termination.png"
        )

        generated += plot_completion(
            df, output_dir / "completion.png"
        )

        generated += plot_reward_components(
            df, output_dir / "reward_components.png"
        )

        print(f"\nGenerated {generated} graph(s) in {output_dir}")
        return 0

    output = output_dir / f"{clean_name(args.metric)}.png"

    if args.metric == "termination":
        success = plot_termination(df, output)

    elif args.metric == "completion":
        success = plot_completion(df, output)

    elif args.metric == "reward_components":
        success = plot_reward_components(df, output)

    else:
        success = plot_numeric(
            df,
            args.metric,
            output,
            group=args.group,
        )

    if not success:
        return 1

    print(f"\nRows loaded: {len(df)}")
    print(f"Metrics with data: {', '.join(metrics)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
