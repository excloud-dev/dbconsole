# DBConsole Makefile
# Usage: make install PORT=8080 HOST=100.103.6.96

# Default values
PORT ?= 3001
HOST ?= 100.103.6.96
NEW ?= false

.PHONY: install install-new dev build clean help

# Install/redeploy the application
install:
ifeq ($(NEW),true)
	sudo ./install.sh --new --port $(PORT) --host $(HOST)
else
	sudo ./install.sh --port $(PORT) --host $(HOST)
endif

# Full fresh installation
install-new:
	sudo ./install.sh --new --port $(PORT) --host $(HOST)

# Run development server
dev:
	npm run dev

# Build the application
build:
	npm run build

# Clean build artifacts
clean:
	rm -rf .next node_modules

# Show help
help:
	@echo "DBConsole Makefile"
	@echo ""
	@echo "Usage:"
	@echo "  make install                    # Redeploy with defaults (port 3000, localhost)"
	@echo "  make install PORT=8080          # Redeploy with custom port"
	@echo "  make install HOST=0.0.0.0       # Redeploy binding to all interfaces"
	@echo "  make install-new                # Full fresh installation"
	@echo "  make install-new PORT=8080 HOST=100.103.6.96"
	@echo "  make dev                        # Run development server"
	@echo "  make build                      # Build for production"
	@echo "  make clean                      # Remove build artifacts"
	@echo ""
	@echo "Variables:"
	@echo "  PORT  - Port number (default: 3000)"
	@echo "  HOST  - IP to bind to (default: 127.0.0.1)"
	@echo "  NEW   - Set to 'true' for fresh install (default: false)"
