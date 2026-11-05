from argparse import ArgumentParser


def main() -> None:
    """Show available command-line options."""
    parser = ArgumentParser(
        prog="tabular-studio",
        description="Tabular Studio (working title): local tabular labelling and rule export.",
    )
    parser.parse_args()
    parser.print_help()
