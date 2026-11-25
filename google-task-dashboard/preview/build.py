"""Builds preview.html: the dashboard from ../webhook with a mocked backend."""

from pathlib import Path

HERE = Path(__file__).resolve().parent
WEBHOOK = HERE.parent / "webhook"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main() -> None:
    page = read(WEBHOOK / "Index.html")
    replacements = {
        # The mock must load before the dashboard script runs.
        "<?!= include('Landscape'); ?>": read(HERE / "mock.html")
        + read(WEBHOOK / "Landscape.html"),
        "<?!= include('JavaScript'); ?>": read(WEBHOOK / "JavaScript.html"),
        "<?!= include('Styles'); ?>": read(WEBHOOK / "Styles.html"),
        "<?= BUILD_COMMIT ?>": "preview",
        "<?= BUILD_TIME ?>": "",
    }
    for placeholder, content in replacements.items():
        if placeholder not in page:
            raise SystemExit(f"Placeholder not found in Index.html: {placeholder}")
        page = page.replace(placeholder, content)

    target = HERE / "preview.html"
    target.write_text(page, encoding="utf-8")
    print(f"Wrote {target}")


if __name__ == "__main__":
    main()
