# Contributing to Lantern

Thank you for your interest in contributing to Lantern! This guide will help you get started with development and contributions.

Lantern is a fork of [Strix](https://github.com/usestrix/strix) — this
guide covers developing Lantern itself (the dashboard, API, deploy stack,
and installer). If your contribution is really about the underlying Strix
agent (the CLI, the hacker toolkit, the LLM adapters), consider sending it
upstream instead, where it benefits everyone building on Strix.

## 🚀 Development Setup

### Prerequisites

- Python 3.12+
- Docker (running)
- [uv](https://docs.astral.sh/uv/) (for dependency management)
- Git

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/charanteja0017/Lantern.git
   cd Lantern
   ```

2. **Install development dependencies**
   ```bash
   make setup-dev

   # or manually:
   uv sync
   uv run pre-commit install
   ```

3. **Configure your LLM provider**
   ```bash
   export STRIX_LLM="openai/gpt-5.4"
   export LLM_API_KEY="your-api-key"
   ```

4. **Run Strix in development mode**
   ```bash
   uv run strix --target https://example.com
   ```

## 📚 Contributing Skills

Skills are specialized knowledge packages that enhance agent capabilities. See [strix/skills/README.md](strix/skills/README.md) for detailed guidelines.

### Quick Guide

1. **Choose the right category** (`/vulnerabilities`, `/frameworks`, `/technologies`, etc.)
2. **Create a** `.md` file with your skill content
3. **Include practical examples** - Working payloads, commands, or test cases
4. **Provide validation methods** - How to confirm findings and avoid false positives
5. **Submit via PR** with clear description

## 🔧 Contributing Code

### Pull Request Process

1. **Create an issue first** - Describe the problem or feature
2. **Fork and branch** - Work from the `main` branch
3. **Make your changes** - Follow existing code style
4. **Write/update tests** - Ensure coverage for new features
5. **Run quality checks** - `make check-all` should pass
6. **Submit PR** - Link to issue and provide context

### PR Guidelines

- **Clear description** - Explain what and why
- **Small, focused changes** - One feature/fix per PR
- **Include examples** - Show before/after behavior
- **Update documentation** - If adding features
- **Pass all checks** - Tests, linting, type checking

### Code Style

- Follow PEP 8 with 100-character line limit
- Use type hints for all functions
- Write docstrings for public methods
- Keep functions focused and small
- Use meaningful variable names

## 🐛 Reporting Issues

File Lantern-specific bugs (dashboard, API, installer, Ubuntu deploy)
against [this repo](https://github.com/charanteja0017/Lantern/issues).
Bugs in the underlying Strix agent belong on the
[upstream tracker](https://github.com/usestrix/strix/issues) instead.

When reporting bugs, please include:

- Python version and OS
- Lantern / Strix version
- LLMs being used
- Full error traceback
- Steps to reproduce
- Expected vs actual behavior

## 💡 Feature Requests

We welcome feature ideas! Please:

- Check existing issues first
- Describe the use case clearly
- Explain why it would benefit users
- Consider implementation approach
- Be open to discussion

## 🤝 Community

- **Lantern issues**: [GitHub Issues](https://github.com/charanteja0017/Lantern/issues)
- **Strix Discord**: [Join the community](https://discord.gg/strix-ai)

## ✨ Recognition

We value all contributions! Contributors will be listed in release notes
and thanked for their work.

---

**Questions?** Open an [issue](https://github.com/charanteja0017/Lantern/issues) — we're here to help.
