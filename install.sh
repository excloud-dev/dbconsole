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
DEFAULT_PORT=3000
DEFAULT_HOST="127.0.0.1"

# Installation mode (set via --new flag)
NEW_INSTALL=false
CUSTOM_PORT=""
CUSTOM_HOST=""
SYNC_SERVER_ONLY=false
SYNC_SERVER_ONLY_EXPLICIT=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

#-------------------------------------------------------------------------------
# Helper Functions
#-------------------------------------------------------------------------------

show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --new           Full installation: installs nvm, Node.js, and all dependencies"
    echo "                  Without this flag, only copies files and restarts the service (redeploy mode)"
    echo "  --port PORT     Custom port number for the application (default: $DEFAULT_PORT)"
    echo "  --host HOST     IP address to bind to (default: $DEFAULT_HOST)"
    echo "  --sync-server-only     Run as a named-query sync relay only (sets DBCONSOLE_SYNC_SERVER_ONLY=1)"
    echo "  --no-sync-server-only  Disable sync-server-only mode (sets DBCONSOLE_SYNC_SERVER_ONLY=0)"
    echo "  --help, -h      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --new                           # Full installation with defaults"
    echo "  $0 --new --port 8080               # Full installation with port 8080"
    echo "  $0 --new --host 0.0.0.0            # Full installation, bind to all interfaces"
    echo "  $0 --new --sync-server-only        # Full installation in sync relay mode"
    echo "  $0 --port 3001 --host 100.103.6.96 # Redeploy with custom port and host"
    echo "  $0                                 # Redeploy with defaults"
    echo ""
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --new)
                NEW_INSTALL=true
                shift
                ;;
            --port)
                if [[ -n "$2" && ! "$2" =~ ^-- ]]; then
                    CUSTOM_PORT=$2
                    shift 2
                else
                    log_error "--port requires a value"
                    exit 1
                fi
                ;;
            --host)
                if [[ -n "$2" && ! "$2" =~ ^-- ]]; then
                    CUSTOM_HOST=$2
                    shift 2
                else
                    log_error "--host requires a value"
                    exit 1
                fi
                ;;
            --sync-server-only)
                SYNC_SERVER_ONLY=true
                SYNC_SERVER_ONLY_EXPLICIT=true
                shift
                ;;
            --no-sync-server-only)
                SYNC_SERVER_ONLY=false
                SYNC_SERVER_ONLY_EXPLICIT=true
                shift
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Set defaults if not specified
    if [[ -z "$CUSTOM_PORT" ]]; then
        CUSTOM_PORT=$DEFAULT_PORT
    fi
    if [[ -z "$CUSTOM_HOST" ]]; then
        CUSTOM_HOST=$DEFAULT_HOST
    fi
    
    # Validate port range
    if [[ $CUSTOM_PORT -lt 1 || $CUSTOM_PORT -gt 65535 ]]; then
        log_error "Port must be between 1 and 65535"
        exit 1
    fi
}

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
    local SYNC_ENV_VALUE="0"
    if [[ "$SYNC_SERVER_ONLY" == "true" ]]; then
        SYNC_ENV_VALUE="1"
    fi
    
    if [[ -f "$ENV_FILE" ]]; then
        # Update the PORT in existing .env file
        if grep -q "^PORT=" "$ENV_FILE"; then
            sed -i "s/^PORT=.*/PORT=$CUSTOM_PORT/" "$ENV_FILE"
            log_info "Updated PORT to $CUSTOM_PORT in existing .env file"
        else
            echo "PORT=$CUSTOM_PORT" >> "$ENV_FILE"
            log_info "Added PORT=$CUSTOM_PORT to existing .env file"
        fi

        # Update the BIND_HOST in existing .env file
        if grep -q "^BIND_HOST=" "$ENV_FILE"; then
            sed -i "s/^BIND_HOST=.*/BIND_HOST=$CUSTOM_HOST/" "$ENV_FILE"
            log_info "Updated BIND_HOST to $CUSTOM_HOST in existing .env file"
        else
            # If HOSTNAME exists (legacy), we can keep it or append BIND_HOST. 
            # Let's append BIND_HOST to be safe and specific.
            echo "BIND_HOST=$CUSTOM_HOST" >> "$ENV_FILE"
            log_info "Added BIND_HOST=$CUSTOM_HOST to existing .env file"
        fi

        # Only update sync-server-only setting if explicitly requested.
        if [[ "$SYNC_SERVER_ONLY_EXPLICIT" == "true" ]]; then
            if grep -q "^DBCONSOLE_SYNC_SERVER_ONLY=" "$ENV_FILE"; then
                sed -i "s/^DBCONSOLE_SYNC_SERVER_ONLY=.*/DBCONSOLE_SYNC_SERVER_ONLY=$SYNC_ENV_VALUE/" "$ENV_FILE"
                log_info "Updated DBCONSOLE_SYNC_SERVER_ONLY to $SYNC_ENV_VALUE in existing .env file"
            else
                echo "DBCONSOLE_SYNC_SERVER_ONLY=$SYNC_ENV_VALUE" >> "$ENV_FILE"
                log_info "Added DBCONSOLE_SYNC_SERVER_ONLY=$SYNC_ENV_VALUE to existing .env file"
            fi
        fi
    else
        # Create a basic .env file (user can customize later)
        cat > "$ENV_FILE" << EOF
# DBConsole Environment Configuration
NODE_ENV=production
PORT=$CUSTOM_PORT
BIND_HOST=$CUSTOM_HOST
DBCONSOLE_SYNC_SERVER_ONLY=$SYNC_ENV_VALUE

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
    echo "Application URL:   http://$CUSTOM_HOST:$CUSTOM_PORT"
    if [[ "$SYNC_SERVER_ONLY" == "true" ]]; then
        echo "Mode:              sync-server-only (named-query relay)"
        echo "Sync endpoints:"
        echo "  Pull:            http://$CUSTOM_HOST:$CUSTOM_PORT/api/sync/named-queries/pull"
        echo "  Push:            http://$CUSTOM_HOST:$CUSTOM_PORT/api/sync/named-queries/push"
    fi
    echo "Install directory: $INSTALL_DIR"
    echo "Environment file:  $INSTALL_DIR/.env"
    echo ""
}

#-------------------------------------------------------------------------------
# Main
#-------------------------------------------------------------------------------

main() {
    # Parse command line arguments first
    parse_arguments "$@"
    
    echo ""
    echo "=============================================="
    echo "  DBConsole Installation Script for Ubuntu"
    echo "=============================================="
    echo ""
    
    if [[ "$NEW_INSTALL" == "true" ]]; then
        echo -e "${BLUE}Mode: Full Installation (--new)${NC}"
    else
        echo -e "${BLUE}Mode: Redeploy (files + restart)${NC}"
    fi
    echo -e "${BLUE}Port: $CUSTOM_PORT${NC}"
    echo -e "${BLUE}Host: $CUSTOM_HOST${NC}"
    if [[ "$SYNC_SERVER_ONLY_EXPLICIT" == "true" ]]; then
        if [[ "$SYNC_SERVER_ONLY" == "true" ]]; then
            echo -e "${BLUE}Sync relay only: enabled${NC}"
        else
            echo -e "${BLUE}Sync relay only: disabled${NC}"
        fi
    fi
    echo ""
    
    check_root
    check_ubuntu
    check_systemd
    
    if [[ "$NEW_INSTALL" == "true" ]]; then
        # Full installation: install everything from scratch
        log_info "Running full installation..."
        install_dependencies
        create_service_user
        install_nvm
        setup_env_file
        setup_application
        install_service
    else
        # Redeploy mode: just copy files and restart service
        log_info "Running redeploy (copying files and restarting service)..."
        
        # Check if service user exists (required for redeploy)
        if ! id "$SERVICE_USER" &>/dev/null; then
            log_error "Service user '$SERVICE_USER' does not exist. Use --new flag for initial setup."
            exit 1
        fi
        
        # Check if nvm/node is installed
        if [[ ! -d "/home/$SERVICE_USER/.nvm" ]]; then
            log_error "nvm not found. Use --new flag for initial setup."
            exit 1
        fi
        
        # Stop service if running
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            log_info "Stopping existing service..."
            systemctl stop "$SERVICE_NAME"
        fi
        
        # Copy files and rebuild
        setup_env_file
        setup_application
        
        # Reload systemd in case service file changed
        systemctl daemon-reload
        
        # Start service
        log_info "Starting $SERVICE_NAME service..."
        systemctl start "$SERVICE_NAME"
        
        # Check status
        sleep 3
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            log_success "Service restarted successfully!"
        else
            log_warning "Service may not have started properly. Check logs with:"
            echo "  sudo journalctl -u $SERVICE_NAME -f"
        fi
    fi
    
    print_summary
}

# Run main function
main "$@"
