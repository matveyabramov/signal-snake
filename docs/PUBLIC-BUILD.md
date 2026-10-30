# Публичная сборка SIGNAL SNAKE

Публикуется только `dist/`. Корень репозитория, `build/demo/` и сервер разработки не являются релизом.

```sh
python3 tools/build-public.py --check
python3 tools/build-public.py --output dist
python3 -m http.server 8772 --bind 127.0.0.1 --directory dist
```

`--check` (также режим по умолчанию) проверяет состав в памяти. `--output dist` создаёт или обновляет сборку; при неизвестных файлах или symlink в папке назначения сборщик останавливается без очистки. Для проверки повторяемости можно повторить команду: содержимое и SHA-256 должны совпасть. Автоматически удалять папку с неизвестным содержимым не нужно.

## Состав

Явный список в `tools/build-public.py`: `snake.html` → `index.html`, Nokia CSS/JS, музыкальный движок и audio graph, Tone.js с лицензиями и уведомлениями встроенных библиотек, три WAV (CALL/PING/CLICK), три используемых шрифта с OFL, семь SVG, `THIRD-PARTY-NOTICES.md` и `.nojekyll`.

`performance/`, `docs/`, `tests/`, `tools/`, `output/`, старые страницы, preview, MIDI, MP3 и PDF отсутствуют. Сборщик встраивает только runtime-данные семи сцен в `snake-story.js`: исходные состояния, подсказки и поля существующего валидатора. Ноты, ритмы и композиция не меняются. Исходная JSON-карта и отдельные карты исполнения не копируются. Музыкальные данные, необходимые браузерному инструменту, доступны посетителю вместе с JS.

Все ссылки на ресурсы относительные, без начального `/`: один и тот же артефакт работает локально в `/` и на Pages в `/signal-snake/`. Сборщик проверяет ссылки HTML/CSS по списку файлов. Никакого fallback из `dist/` в исходный проект нет. Внутренние URL должны получать 404; `robots.txt` не служит защитой доступа.

## GitHub Pages

`.github/workflows/pages.yml` собирает `dist/` на чистом checkout, загружает только её и выполняет deploy через официальный Pages artifact. Триггер только `workflow_dispatch`, ветка только `main`; автоматического деплоя при push нет. Права публикации и OIDC доступны только deployment job. Конкурентные запуски сериализуются; production-сборка не требует установки внешних пакетов.

Для первой публикации: после разрешения владельца commit/push → Settings / Pages / GitHub Actions → Actions / Publish SIGNAL SNAKE / Run workflow / main. У `github-pages` могут действовать правила ручного подтверждения окружения.

30 октября 2026 года коннектор GitHub подтвердил `visibility: private`, owner type `User`, default branch `main`. Страница Settings → Pages показала **«Upgrade or make this repository public to enable Pages»**. На текущем тарифе приватный репозиторий публиковать нельзя. Для сохранения private нужен GitHub Pro; альтернативный перевод в public требует отдельного разрешения и откроет все исходники и внутренние материалы репозитория. Настройки в ходе подготовки не менялись. [Официальные ограничения](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Повторение целевого QA

При установленном Playwright и Chrome:

```sh
python3 tools/build-public.py --output dist
node tests/release-browser.test.cjs
```

Если Playwright установлен вне обычного пути, передать путь через `PLAYWRIGHT_MODULE`. Результаты и снимки по умолчанию находятся в `/private/tmp/signal-snake-stage08/`; папку можно изменить через `RESULT_DIR`. Тест сам поднимает изолированный сервер только для `dist/` под `/signal-snake/` на свободном localhost-порту. Тесты и инструменты QA не входят в публичную сборку.
