#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

info() {
  echo "release: $*"
}

confirm() {
  local prompt="${1:-Continue?}"
  local ans
  read -r -p "${prompt} [y/N] " ans || true
  case "${ans}" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

bump_semver() {
  local version="$1"
  local bump="$2"
  local major minor patch

  IFS='.' read -r major minor patch <<<"${version}"
  [[ "${major}" =~ ^[0-9]+$ && "${minor}" =~ ^[0-9]+$ && "${patch}" =~ ^[0-9]+$ ]] || die "invalid semver: ${version}"

  case "${bump}" in
    patch)
      patch=$((patch + 1))
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    *)
      die "invalid bump: ${bump} (expected patch|minor|major)"
      ;;
  esac

  echo "${major}.${minor}.${patch}"
}

is_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

escape_ere() {
  # Escape for ERE regex usage (grep -E / awk).
  printf '%s' "$1" | sed -E 's/[][\\.^$*+?()|{}]/\\&/g'
}

git_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

ensure_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree is dirty; commit/stash changes before releasing"
  fi
}

latest_reachable_tag() {
  git describe --tags --match 'v*' --abbrev=0 2>/dev/null || true
}

tag_exists() {
  local tag="$1"
  git rev-parse -q --verify "refs/tags/${tag}" >/dev/null 2>&1
}

tag_points_at_head() {
  local tag="$1"
  local tag_sha head_sha
  tag_sha="$(git rev-parse "${tag}" 2>/dev/null || true)"
  head_sha="$(git rev-parse HEAD)"
  [[ -n "${tag_sha}" && "${tag_sha}" == "${head_sha}" ]]
}

get_pkg_version() {
  # npm prints JSON strings; strip quotes.
  npm pkg get version 2>/dev/null | tr -d '"'
}

add_changelog_section_if_missing() {
  local tag="$1"
  local last_tag="$2"
  local changelog="CHANGELOG.md"
  local today
  today="$(date -u +%Y-%m-%d)"

  if [[ ! -f "${changelog}" ]]; then
    cat > "${changelog}" <<EOF
# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- TBD
EOF
  fi

  local tag_escaped
  tag_escaped="$(escape_ere "${tag}")"
  if grep -Eq "^##[[:space:]]+\\[?${tag_escaped}\\]?([[:space:]]+-.*)?[[:space:]]*$" "${changelog}"; then
    info "CHANGELOG already contains ${tag}; skipping changelog generation"
    return 0
  fi

  local range
  if [[ -n "${last_tag}" ]]; then
    range="${last_tag}..HEAD"
  else
    range="HEAD"
  fi

  local changes
  if [[ "${range}" == "HEAD" ]]; then
    changes="$(git log --no-merges --reverse --pretty=format:'- %s (%h)')"
  else
    changes="$(git log --no-merges --reverse --pretty=format:'- %s (%h)' "${range}")"
  fi

  if [[ -z "${changes}" ]]; then
    changes="- No changes."
  fi

  local section_file out_file
  section_file="$(mktemp)"
  out_file="$(mktemp)"
  cat > "${section_file}" <<EOF
## ${tag} - ${today}

${changes}
EOF

  # Ensure Unreleased exists. If not, prepend it.
  if ! grep -Eq '^##[[:space:]]+Unreleased[[:space:]]*$' "${changelog}"; then
    info "CHANGELOG missing '## Unreleased'; adding it"
    cat > "${out_file}" <<EOF
# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- TBD

EOF
    cat "${changelog}" >> "${out_file}"
    mv "${out_file}" "${changelog}"
    out_file="$(mktemp)"
  fi

  # Insert release section after the Unreleased block (right before the next "## " heading).
  awk -v secfile="${section_file}" '
    function print_section() {
      while ((getline s < secfile) > 0) print s
      close(secfile)
    }
    BEGIN { inserted = 0; in_unreleased = 0 }
    /^##[[:space:]]+Unreleased[[:space:]]*$/ { in_unreleased = 1; print; next }
    /^##[[:space:]]+/ {
      if (in_unreleased && !inserted) {
        print ""
        print_section()
        print ""
        inserted = 1
        in_unreleased = 0
      }
      print
      next
    }
    { print }
    END {
      if (in_unreleased && !inserted) {
        print ""
        print_section()
        print ""
      }
    }
  ' "${changelog}" > "${out_file}"

  mv "${out_file}" "${changelog}"
  rm -f "${section_file}"
  info "Added CHANGELOG section for ${tag}"
}

main() {
  need_cmd git
  need_cmd npm

  local root
  root="$(git_root)" || die "not in a git repo"
  cd "${root}"

  local bump="patch"
  local explicit_version=""
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    cat <<'EOF'
Usage:
  ./release.sh                 # bumps patch from last reachable v* tag
  ./release.sh patch|minor|major
  ./release.sh X.Y.Z           # explicit version

What it does:
  - Fetches tags from origin (best-effort)
  - Figures out the last reachable v* tag from HEAD
  - Bumps package.json/package-lock.json version (via `npm version --no-git-tag-version`)
  - Adds a CHANGELOG.md section for the new tag (from git commits), if missing
  - Commits and tags the release
  - Prompts before pushing to origin
EOF
    exit 0
  fi

  if [[ -n "${1:-}" ]]; then
    if [[ "${1}" == "patch" || "${1}" == "minor" || "${1}" == "major" ]]; then
      bump="${1}"
    elif is_semver "${1}"; then
      explicit_version="${1}"
    else
      die "unknown argument: ${1} (expected patch|minor|major|X.Y.Z)"
    fi
  fi

  ensure_clean_tree

  if git remote get-url origin >/dev/null 2>&1; then
    info "Fetching tags from origin…"
    git fetch origin --tags --prune --quiet || info "Failed to fetch tags from origin (continuing with local tags)"
  else
    info "No 'origin' remote; skipping tag fetch"
  fi

  local last_tag last_version
  last_tag="$(latest_reachable_tag)"
  last_version="${last_tag#v}"

  local current_version
  current_version="$(get_pkg_version)"
  [[ -n "${current_version}" ]] || die "failed to read package.json version"

  # If HEAD is already tagged, treat this as a "push-only" rerun (idempotent).
  if [[ -n "${last_tag}" ]] && tag_points_at_head "${last_tag}"; then
    info "HEAD is already tagged as ${last_tag}."
    if confirm "Push commit and tag ${last_tag} to origin?"; then
      if git remote get-url origin >/dev/null 2>&1; then
        git push origin HEAD
        set +e
        git push origin "${last_tag}"
        rc=$?
        set -e
        if [[ "${rc}" -ne 0 ]]; then
          info "Tag push failed (it may already exist on origin)."
        fi
        info "Pushed."
      else
        info "No 'origin' remote; skipping push"
      fi
    else
      info "Skipped push."
    fi
    exit 0
  fi

  local target_version
  if [[ -n "${explicit_version}" ]]; then
    target_version="${explicit_version}"
  else
    if [[ -z "${last_tag}" ]]; then
      # First release: default to whatever package.json says (no auto-bump).
      target_version="${current_version}"
    else
      target_version="$(bump_semver "${last_version}" "${bump}")"
    fi
  fi

  local tag="v${target_version}"

  # If there are no new commits since last tag, there is nothing to release.
  if [[ -n "${last_tag}" ]]; then
    local commit_count
    commit_count="$(git rev-list "${last_tag}..HEAD" --count)"
    if [[ "${commit_count}" == "0" ]]; then
      if tag_exists "${last_tag}" && tag_points_at_head "${last_tag}"; then
        info "No commits since ${last_tag}; nothing to release."
        exit 0
      fi
      die "no commits since ${last_tag}"
    fi
  fi

  # If the target tag already exists but is not on HEAD, refuse to reuse it.
  if tag_exists "${tag}" && ! tag_points_at_head "${tag}"; then
    die "tag ${tag} already exists (not on HEAD); choose a different version"
  fi

  info "Last tag: ${last_tag:-<none>}"
  info "Current version: ${current_version}"
  info "Target version: ${target_version} (${tag})"

  if [[ "${current_version}" != "${target_version}" ]]; then
    info "Bumping package.json/package-lock.json version to ${target_version}"
    npm version "${target_version}" --no-git-tag-version >/dev/null
  else
    info "package.json already at ${target_version}; skipping version bump"
  fi

  add_changelog_section_if_missing "${tag}" "${last_tag}"

  if [[ -n "$(git status --porcelain)" ]]; then
    git add CHANGELOG.md package.json package-lock.json 2>/dev/null || true
    if ! git diff --cached --quiet; then
      git commit -m "release: ${tag}"
    else
      info "No staged changes to commit"
    fi
  else
    info "No changes to commit"
  fi

  if tag_exists "${tag}"; then
    info "Tag ${tag} already exists locally; skipping tag creation"
  else
    git tag -a "${tag}" -m "${tag}"
    info "Created tag ${tag}"
  fi

  info "Release prepared locally."
  if confirm "Push commit and tag ${tag} to origin?"; then
    if git remote get-url origin >/dev/null 2>&1; then
      git push origin HEAD
      # Push tag; if it already exists remotely, don't fail the whole release script.
      set +e
      git push origin "${tag}"
      rc=$?
      set -e
      if [[ "${rc}" -ne 0 ]]; then
        info "Tag push failed (it may already exist on origin)."
      fi
      info "Pushed."
    else
      info "No 'origin' remote; skipping push"
    fi
  else
    info "Skipped push."
  fi

  info "Done."
}

main "$@"
