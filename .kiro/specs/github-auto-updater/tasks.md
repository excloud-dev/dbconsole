# Implementation Plan

- [x] 1. Set up project structure and core interfaces
  - Create directory structure for updater components (`lib/updater/`)
  - Define TypeScript interfaces for UpdateAgent, GitHubClient, UpdateController, and ConfigService
  - Set up testing framework with fast-check for property-based testing
  - Install required dependencies (electron-updater, fast-check, semver)
  - _Requirements: 1.1, 2.1, 3.1_

- [x] 1.1 Write property test for update check timing
  - **Property 1: Update check timing consistency**
  - **Validates: Requirements 1.1**

- [x] 2. Implement GitHub API client with authentication
  - [x] 2.1 Create GitHubClient class with token-based authentication
    - Implement authentication header management
    - Create methods for fetching releases and assets
    - Add request/response logging for debugging
    - _Requirements: 1.3, 2.1, 2.5_

  - [x] 2.2 Write property test for authentication headers
    - **Property 3: Authentication header presence**
    - **Validates: Requirements 1.3**

  - [x] 2.3 Implement release fetching and filtering
    - Add methods to get latest release and filter by channel
    - Implement platform-specific asset selection logic
    - Handle GitHub API pagination for release lists
    - _Requirements: 1.4, 2.4, 3.1_

  - [x] 2.4 Write property test for channel filtering
    - **Property 9: Channel filtering consistency**
    - **Validates: Requirements 2.4**

  - [x] 2.5 Write property test for platform asset selection
    - **Property 11: Platform-specific asset selection**
    - **Validates: Requirements 3.1**

- [x] 3. Implement secure configuration service
  - [x] 3.1 Create ConfigService with encrypted credential storage
    - Implement secure token storage using Electron's safeStorage API
    - Add methods for storing and retrieving update settings
    - Create configuration validation logic
    - _Requirements: 2.2, 2.3, 7.1, 7.2_

  - [x] 3.2 Write property test for credential encryption
    - **Property 7: Credential encryption invariant**
    - **Validates: Requirements 2.2**

  - [x] 3.3 Write property test for configuration persistence
    - **Property 8: Configuration persistence**
    - **Validates: Requirements 2.3**

  - [x] 3.4 Implement update policy enforcement
    - Add policy validation and precedence logic
    - Implement maintenance window checking
    - Create enterprise policy detection
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 3.5 Write property test for policy precedence
    - **Property 31: Policy precedence consistency**
    - **Validates: Requirements 7.5**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement version comparison and update detection
  - [x] 5.1 Create semantic version comparison utilities
    - Implement semver parsing and comparison logic
    - Add support for pre-release version handling
    - Create version validation functions
    - _Requirements: 1.4, 2.4_

  - [x] 5.2 Write property test for version comparison
    - **Property 4: Version comparison accuracy**
    - **Validates: Requirements 1.4**

  - [x] 5.3 Implement update availability detection
    - Create logic to determine when updates are available
    - Add support for different update channels
    - Implement forced update detection
    - _Requirements: 1.5, 2.4_

  - [x] 5.4 Write property test for update notifications
    - **Property 5: Update notification consistency**
    - **Validates: Requirements 1.5**

- [x] 6. Implement network resilience and error handling
  - [x] 6.1 Create retry logic with exponential backoff
    - Implement configurable retry mechanisms
    - Add exponential backoff for failed requests
    - Create network connectivity detection
    - _Requirements: 4.1, 4.4, 4.5_

  - [x] 6.2 Write property test for retry behavior
    - **Property 14: Exponential backoff retry behavior**
    - **Validates: Requirements 4.1**

  - [x] 6.3 Implement GitHub rate limit handling
    - Parse rate limit headers from GitHub API responses
    - Add automatic delay logic for rate-limited requests
    - Create rate limit status reporting
    - _Requirements: 4.2_

  - [x] 6.4 Write property test for rate limit compliance
    - **Property 15: Rate limit compliance**
    - **Validates: Requirements 4.2**

  - [x] 6.5 Add offline detection and adaptive intervals
    - Implement network connectivity monitoring
    - Add adaptive check interval logic for failed requests
    - Create offline mode handling
    - _Requirements: 4.4, 4.5_

  - [x] 6.6 Write property test for offline handling
    - **Property 18: Offline detection and handling**
    - **Validates: Requirements 4.5**

- [x] 7. Implement file download and verification system
  - [x] 7.1 Create download manager with progress tracking
    - Implement file download with progress events
    - Add support for resumable downloads using HTTP range requests
    - Create download cancellation and cleanup logic
    - _Requirements: 3.2, 4.3, 5.1_

  - [x] 7.2 Write property test for download progress
    - **Property 19: Download progress reporting**
    - **Validates: Requirements 5.1**

  - [x] 7.3 Write property test for download resumption
    - **Property 16: Download resumption capability**
    - **Validates: Requirements 4.3**

  - [x] 7.4 Implement file integrity verification
    - Add checksum verification using SHA-256
    - Implement digital signature validation
    - Create retry logic for failed verifications
    - _Requirements: 3.2, 6.1, 6.2, 6.4_

  - [x] 7.5 Write property test for checksum verification
    - **Property 23: Checksum verification consistency**
    - **Validates: Requirements 6.1**

  - [x] 7.6 Write property test for signature validation
    - **Property 24: Digital signature validation**
    - **Validates: Requirements 6.2**

  - [x] 7.7 Write property test for checksum retry logic
    - **Property 26: Checksum retry logic**
    - **Validates: Requirements 6.4**

- [x] 8. Implement UpdateAgent core service
  - [x] 8.1 Create UpdateAgent class with lifecycle management
    - Implement main update checking and download coordination
    - Add update state management and event emission
    - Create integration with file download and verification systems
    - _Requirements: 1.1, 1.2, 3.1, 3.2_

  - [x] 8.2 Write property test for periodic checks
    - **Property 2: Periodic check interval adherence**
    - **Validates: Requirements 1.2**

  - [x] 8.3 Add error handling and logging
    - Implement comprehensive error handling for all update operations
    - Add structured logging for debugging and monitoring
    - Create error recovery mechanisms
    - _Requirements: 2.5, 6.3_

  - [x] 8.4 Write property test for authentication errors
    - **Property 10: Authentication error handling**
    - **Validates: Requirements 2.5**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement UpdateController orchestration layer
  - [x] 10.1 Create UpdateController with user interaction management
    - Implement update orchestration and user notification logic
    - Add background checker management
    - Create update history tracking
    - _Requirements: 1.5, 5.4, 5.5_

  - [x] 10.2 Write property test for update history
    - **Property 22: Update history persistence**
    - **Validates: Requirements 5.5**

  - [x] 10.3 Implement release notes fetching and display
    - Add release notes retrieval from GitHub releases
    - Create formatted display of release information
    - Implement update completion notifications
    - _Requirements: 5.2, 5.4_

  - [x] 10.4 Write property test for release notes
    - **Property 20: Release notes retrieval**
    - **Validates: Requirements 5.2**

  - [x] 10.5 Write property test for completion notifications
    - **Property 21: Update completion notification**
    - **Validates: Requirements 5.4**

- [x] 11. Implement Electron desktop app integration
  - [x] 11.1 Create Electron updater integration
    - Integrate with Electron's autoUpdater module
    - Add desktop-specific update installation logic
    - Implement application restart handling
    - _Requirements: 3.3, 3.4_

  - [x] 11.2 Add desktop UI components for update notifications
    - Create update notification dialogs
    - Add progress indicators for downloads and installations
    - Implement user preference settings UI
    - _Requirements: 1.5, 5.1, 5.3_

  - [x] 11.3 Implement desktop-specific error handling
    - Add platform-specific error handling for installation failures
    - Create rollback mechanisms for failed updates
    - Implement permission and disk space checking
    - _Requirements: 3.4_

- [x] 12. Implement web app update detection and notifications
  - [x] 12.1 Enhance existing web app version checking service
    - Extend existing `/api/app-info` endpoint with GitHub release checking
    - Add client-side version comparison logic using existing app info
    - Create web-specific update notification system
    - _Requirements: 3.5_

  - [x] 12.2 Write property test for web app notifications
    - **Property 13: Web app version notification**
    - **Validates: Requirements 3.5**

  - [x] 12.3 Add service worker integration for web updates
    - Implement service worker-based update detection
    - Add cache invalidation for new versions
    - Create seamless update experience for web users
    - _Requirements: 3.5_

- [x] 13. Implement comprehensive error handling and security features
  - [x] 13.1 Implement security verification system
    - Add comprehensive file integrity checking
    - Implement signature verification with proper error handling
    - Create security failure alerting and logging
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 13.2 Write property test for signature failures
    - **Property 25: Signature failure rejection**
    - **Validates: Requirements 6.3**

  - [x] 13.3 Add token validation and management
    - Implement GitHub token format validation
    - Add token expiration detection and renewal prompts
    - Create secure token storage verification
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 13.4 Write property test for token validation
    - **Property 6: Token format validation**
    - **Validates: Requirements 2.1**

- [x] 14. Integration and system testing
  - [x] 14.1 Create integration test suite
    - Add end-to-end testing with mock GitHub API
    - Test complete update workflows from check to installation
    - Verify cross-platform compatibility
    - _Requirements: All_

  - [x] 14.2 Write integration tests for complete update flow
    - Test full update cycle from detection through installation
    - Verify proper error handling in integration scenarios
    - Test policy enforcement in realistic scenarios
    - _Requirements: All_

  - [x] 14.3 Add performance and load testing
    - Test update system under various network conditions
    - Verify memory usage during large file downloads
    - Test concurrent update operations
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.