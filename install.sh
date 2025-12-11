#!/bin/bash

#===============================================================================
# DBConsole Installation Script for Ubuntu
# This script installs and configures dbconsole as a systemd service
#===============================================================================

set -e

# Configuration
INSTALL_DIR="/opt/dbconsole"
SERVICE_USER="dbconsole"
SERVICE_GROUP="dbconsole"
NODE_VERSION="lts/*"
SERVICE_NAME="dbconsole"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

#-------------------------------------------------------------------------------
# Helper Functions
#-------------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
}

#-------------------------------------------------------------------------------
# System Checks
#-------------------------------------------------------------------------------

check_ubuntu() {
    log_info "Checking operating system..."
    
    if [[ ! -f /etc/os-release ]]; then
        log_error "Cannot determine OS. /etc/os-release not found."
        exit 1
    fi
    
    source /etc/os-release
    
    if [[ "$ID" != "ubuntu" && "$ID_LIKE" != *"ubuntu"* && "$ID_LIKE" != *"debian"* ]]; then
        log_error "This script is designed for Ubuntu/Debian. Detected: $ID"
        exit 1
    fi
    
    log_success "Operating system: $PRETTY_NAME"
}

check_systemd() {
    log_info "Checking for systemd..."
    
    if ! command -v systemctl &> /dev/null; then
        log_error "systemd is not installed or not available"
        log_info "Installing systemd..."
        apt-get update
        apt-get install -y systemd
    fi
    
    if ! pidof systemd &> /dev/null; then
        log_warning "systemd is installed but not running as PID 1"
        log_warning "Service may not start automatically until system reboot"
    fi
    
    log_success "systemd is available"
}

#-------------------------------------------------------------------------------
# Install Dependencies
#-------------------------------------------------------------------------------

install_dependencies() {
    log_info "Updating package lists..."
    apt-get update
    
    log_info "Installing required packages..."
    apt-get install -y \
        curl \
        git \
        build-essential \
        python3 \
        ca-certificates
    
    log_success "Dependencies installed"
}

#-------------------------------------------------------------------------------
# Create Service User
#-------------------------------------------------------------------------------

create_service_user() {
    log_info "Creating service user: $SERVICE_USER..."
    
    if id "$SERVICE_USER" &>/dev/null; then
        log_warning "User $SERVICE_USER already exists"
    else
        useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
        log_success "Created user: $SERVICE_USER"
    fi
}

#-------------------------------------------------------------------------------
# Install NVM and Node.js
#-------------------------------------------------------------------------------

install_nvm() {
    log_info "Installing nvm for user $SERVICE_USER..."
    
    local NVM_DIR="/home/$SERVICE_USER/.nvm"
    
    if [[ -d "$NVM_DIR" ]]; then
        log_warning "nvm already installed at $NVM_DIR"
    else
        # Download and install nvm as the service user
        sudo -u "$SERVICE_USER" bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
        log_success "nvm installed"
    fi
    
    # Install Node.js
    log_info "Installing Node.js ($NODE_VERSION)..."
    sudo -u "$SERVICE_USER" bash -c "source /home/$SERVICE_USER/.nvm/nvm.sh && nvm install $NODE_VERSION && nvm alias default $NODE_VERSION"
    
    log_success "Node.js installed"
}

#-------------------------------------------------------------------------------
# Setup Application
#-------------------------------------------------------------------------------

setup_application() {
    log_info "Setting up application directory..."
    
    # Get the directory where this script is located
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    
    # Copy application files (excluding node_modules, .git, etc.)
    log_info "Copying application files to $INSTALL_DIR..."
    rsync -av --exclude='node_modules' \
              --exclude='.git' \
              --exclude='.next' \
              --exclude='*.sqlite' \
              --exclude='*.sqlite-wal' \
              --exclude='*.sqlite-shm' \
              "$SCRIPT_DIR/" "$INSTALL_DIR/"
    
    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    
    log_success "Application files copied"
    
    # Install npm dependencies
    log_info "Installing npm dependencies..."
    sudo -u "$SERVICE_USER" bash -c "source /home/$SERVICE_USER/.nvm/nvm.sh && cd $INSTALL_DIR && npm install"
    
    log_success "npm dependencies installed"
    
    # Build the application
    log_info "Building Next.js application..."
    sudo -u "$SERVICE_USER" bash -c "source /home/$SERVICE_USER/.nvm/nvm.sh && cd $INSTALL_DIR && npm run build"
    
    log_success "Application built"
}

#-------------------------------------------------------------------------------
# Setup Environment File
#-------------------------------------------------------------------------------

setup_env_file() {
    log_info "Setting up environment file..."
    
    local ENV_FILE="$INSTALL_DIR/.env"
    
    if [[ -f "$ENV_FILE" ]]; then
        log_warning ".env file already exists, skipping..."
    else
        # Create a basic .env file (user can customize later)
        cat > "$ENV_FILE" << 'EOF'
# DBConsole Environment Configuration
NODE_ENV=production
PORT=3000

# Add your database connection strings and other config here
# DATABASE_URL=postgresql://user:password@localhost:5432/dbname
EOF
        chown "$SERVICE_USER:$SERVICE_GROUP" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
        log_success "Created .env file at $ENV_FILE"
        log_info "Edit $ENV_FILE to configure your database connections"
    fi
}

#-------------------------------------------------------------------------------
# Install Systemd Service
#-------------------------------------------------------------------------------

install_service() {
    log_info "Installing systemd service..."
    
    local SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    
    # Copy service file
    cp "$INSTALL_DIR/dbconsole.service" "$SERVICE_FILE"
    
    # Reload systemd
    systemctl daemon-reload
    
    # Enable service to start on boot
    systemctl enable "$SERVICE_NAME"
    
    log_success "Systemd service installed and enabled"
    
    # Start the service
    log_info "Starting $SERVICE_NAME service..."
    systemctl start "$SERVICE_NAME"
    
    # Check status
    sleep 3
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service started successfully!"
    else
        log_warning "Service may not have started properly. Check logs with:"
        echo "  sudo journalctl -u $SERVICE_NAME -f"
    fi
}

#-------------------------------------------------------------------------------
# Print Summary
#-------------------------------------------------------------------------------

print_summary() {
    echo ""
    echo "=============================================="
    echo -e "${GREEN}Installation Complete!${NC}"
    echo "=============================================="
    echo ""
    echo "Service Status:"
    systemctl status "$SERVICE_NAME" --no-pager -l || true
    echo ""
    echo "Useful Commands:"
    echo "  Check status:    sudo systemctl status $SERVICE_NAME"
    echo "  View logs:       sudo journalctl -u $SERVICE_NAME -f"
    echo "  Restart:         sudo systemctl restart $SERVICE_NAME"
    echo "  Stop:            sudo systemctl stop $SERVICE_NAME"
    echo ""
    echo "Application URL:   http://localhost:3000"
    echo "Install directory: $INSTALL_DIR"
    echo "Environment file:  $INSTALL_DIR/.env"
    echo ""
}

#-------------------------------------------------------------------------------
# Main
#-------------------------------------------------------------------------------

main() {
    echo ""
    echo "=============================================="
    echo "  DBConsole Installation Script for Ubuntu"
    echo "=============================================="
    echo ""
    
    check_root
    check_ubuntu
    check_systemd
    install_dependencies
    create_service_user
    install_nvm
    setup_application
    setup_env_file
    install_service
    print_summary
}

# Run main function
main "$@"
