"""Готовит записи природы для фона помидора: python3 scripts/zvuki.py [папка-кэш]

Берёт записи из открытых приложений Blanket и Moodist (лицензии — public/sounds/ИСТОЧНИКИ.md),
обрезает края, срезает гул снизу, выравнивает громкость (как в Blanket: все звуки на одном уровне,
чтобы ползунки в микшере значили одно и то же), ограничивает пики и пишет mp3 в public/sounds/.
Гром и сову режет на отдельные удары: приложение ставит их по одному со случайными паузами.

Новый звук: строка в ЗВУКИ (или в УДАРЫ), запуск скрипта, запись в SOUNDS (src/lib/ambient.ts)
и строка в ИСТОЧНИКИ.md.
"""
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

BLANKET = "https://raw.githubusercontent.com/rafaelmardojai/blanket/master/data/resources/sounds/"
MOODIST = "https://raw.githubusercontent.com/remvze/moodist/main/public/sounds/"

# id: (адрес, громкость LUFS, срез снизу Гц)
ЗВУКИ = {
    "rain": (MOODIST + "rain/light-rain.mp3", -24, 40),
    "leaves": (MOODIST + "rain/rain-on-leaves.mp3", -24, 40),
    "stream": (BLANKET + "stream.ogg", -24, 40),
    "river": (MOODIST + "nature/river.mp3", -25, 30),
    "waves": (BLANKET + "waves.ogg", -24, 30),
    "trees": (MOODIST + "nature/wind-in-trees.mp3", -25, 50),
    "wind": (MOODIST + "nature/wind.mp3", -26, 80),
    "birds": (BLANKET + "birds.ogg", -25, 120),
    "crickets": (MOODIST + "animals/crickets.mp3", -25, 80),
    "fire": (MOODIST + "nature/campfire.mp3", -25, 50),
}
# id: (адрес, громкость LUFS, [(с, по), …], срез сверху Гц, мерить по пику) — отдельные удары
# из одной записи. Раскат грома меряется по самым громким 3 секундам, а не в среднем: иначе
# тихий раскат вытянут вровень с громким. Гром «вдали»: верх срезан, раскат не громче дождя
# (13.11.26). Уханье совы короче 3 секунд — его меряем в среднем.
УДАРЫ = {
    "thunder": (MOODIST + "rain/thunder.mp3", -24, [(0.7, 16.2), (21.0, 34.4), (39.6, 47.3), (47.3, 66.2)], 2500, True),
    "owl": (MOODIST + "animals/owl.mp3", -24, [(3.2, 6.0), (9.8, 12.9)], None, False),
}
КРАЙ = 1.5  # столько секунд срезать с краёв длинной записи: там бывают затухания
ДОЛЬШЕ_НЕ = 150  # длиннее не нужно: приложение и так играет кусками вразброс

КОРЕНЬ = Path(__file__).resolve().parent.parent
ВЫХОД = КОРЕНЬ / "public" / "sounds"


def скачать(адрес: str, кэш: Path) -> Path:
    путь = кэш / адрес.split("/sounds/")[-1].replace("/", "_")
    if not путь.exists():
        urllib.request.urlretrieve(адрес, путь)
    return путь


def свойства(путь: Path) -> tuple[float, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", str(путь)],
        capture_output=True, text=True, check=True,
    ).stdout
    o = json.loads(out)
    return float(o["format"]["duration"]), int(o["streams"][0]["sample_rate"])


def громкость(путь: Path, начало: float, длина: float, фильтр: str, пик: bool = False) -> float:
    """Громкость LUFS: в среднем по записи или (пик) самых громких 3 секунд."""
    err = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-ss", str(начало), "-t", str(длина), "-i", str(путь),
         "-af", f"{фильтр},ebur128=framelog=info", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    if пик:
        return max(float(x) for x in re.findall(r"\bS:\s*(-?[\d.]+)", err))
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])


def записать(путь: Path, выход: Path, начало: float, длина: float, цель: float, срез: int,
             вход_затух: float, выход_затух: float, сверху: int | None = None, удар: bool = False) -> None:
    _, частота = свойства(путь)
    полоса = f"highpass=f={срез}" + (f",lowpass=f={сверху}" if сверху else "")
    сдвиг = цель - громкость(путь, начало, длина, полоса, пик=удар)
    фильтры = [
        полоса,
        f"volume={сдвиг:.2f}dB",
        "alimiter=limit=0.79:level=false",  # пики не выше −2 дБ: mp3 при кодировании их поднимает
        f"afade=t=in:d={вход_затух}",
        f"afade=t=out:st={длина - выход_затух:.2f}:d={выход_затух}",
    ]
    битрейт = "128k" if частота >= 44100 else "96k"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", str(начало), "-t", f"{длина:.2f}", "-i", str(путь),
         "-af", ",".join(фильтры), "-ac", "2", "-ar", str(min(частота, 44100)),
         "-c:a", "libmp3lame", "-b:a", битрейт, "-map_metadata", "-1", str(выход)],
        check=True,
    )


def main() -> None:
    кэш = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".cache" / "notedocal-zvuki"
    кэш.mkdir(parents=True, exist_ok=True)
    ВЫХОД.mkdir(parents=True, exist_ok=True)
    for id_, (адрес, цель, срез) in ЗВУКИ.items():
        путь = скачать(адрес, кэш)
        длина, _ = свойства(путь)
        начало = КРАЙ if длина > 20 else 0
        кусок = min(длина - 2 * начало, ДОЛЬШЕ_НЕ)
        записать(путь, ВЫХОД / f"{id_}.mp3", начало, кусок, цель, срез, 0.05, 0.05)
        print(f"{id_:9} {кусок:6.1f} с  {(ВЫХОД / f'{id_}.mp3').stat().st_size / 1e6:.2f} МБ")
    for id_, (адрес, цель, куски, сверху, по_пику) in УДАРЫ.items():
        путь = скачать(адрес, кэш)
        for n, (с, по) in enumerate(куски, 1):
            выход = ВЫХОД / f"{id_}-{n}.mp3"
            записать(путь, выход, с, по - с, цель, 40, 0.03, min(1.0, (по - с) / 4), сверху, удар=по_пику)
            print(f"{id_}-{n:<3}   {по - с:6.1f} с  {выход.stat().st_size / 1e6:.2f} МБ")


if __name__ == "__main__":
    main()
