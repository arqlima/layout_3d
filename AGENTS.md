# AGENTS.md

## Project overview

This repository is a Django project for managing 3D project models and related user accounts. The main app configuration lives in [app/settings.py](app/settings.py) and routes are defined in [app/urls.py](app/urls.py).

Key apps:
- [accounts](accounts): authentication, login, logout, and registration flows
- [projects3d](projects3d): CRUD for project records and their uploaded 3D model files

The project is configured in [pyproject.toml](pyproject.toml) with Django 6.1.2 and Python >= 3.13.

## Working conventions

- Prefer app-local changes over root-level logic. Keep feature behavior near the relevant app (`accounts` or `projects3d`).
- Preserve the existing URL namespace pattern: `accounts:*` and `projects3d:*` are already registered in [accounts/urls.py](accounts/urls.py) and [projects3d/urls.py](projects3d/urls.py).
- Follow the existing class-based Django view style used in [accounts/views.py](accounts/views.py) and [projects3d/views.py](projects3d/views.py).
- Keep templates in the app template folders or the root [templates](templates) directory, and keep static assets under each app’s own static folder (for example [projects3d/static/projects3d](projects3d/static/projects3d)).
- Media uploads are stored under [media](media) and the project model currently uses `FileField(upload_to='projects3d/models/')` in [projects3d/models.py](projects3d/models.py).
- When changing models, remember to update migrations and run Django migration commands.

## Validation commands

Whenever you change code, validate with the smallest relevant Django checks first:

- `python manage.py check`
- `python manage.py test`

For schema changes:
- `python manage.py makemigrations`
- `python manage.py migrate`

## Project-specific notes

- The app uses SQLite for local development via [app/settings.py](app/settings.py).
- The default login redirect is configured to the project list page, so auth-related changes should remain consistent with the existing flow.
- Keep naming consistent with existing Django conventions: app names are lowercase, service classes are view-based, and templates remain descriptive and app-scoped.

## Expectations for AI agents

- Do not introduce unrelated frameworks or architecture changes.
- Keep changes minimal and aligned with the existing Django structure.
- If a new feature spans multiple apps, update the relevant views, URLs, templates, and models consistently in one change set.
