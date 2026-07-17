import CryptoKit
import Darwin
import Foundation

struct TchurchStudioLANAssetCacheLimits: Equatable {
    static let production = TchurchStudioLANAssetCacheLimits()

    let maximumImageBytes: Int64
    let maximumCacheBytes: Int64
    let minimumAvailableCapacity: Int64
    let streamChunkBytes: Int
    let maximumAuthorizationManifests: Int

    init(
        maximumImageBytes: Int64 = 64 * 1_024 * 1_024,
        maximumCacheBytes: Int64 = 2 * 1_024 * 1_024 * 1_024,
        minimumAvailableCapacity: Int64 = 1 * 1_024 * 1_024 * 1_024,
        streamChunkBytes: Int = 64 * 1_024,
        maximumAuthorizationManifests: Int = 256
    ) {
        self.maximumImageBytes = maximumImageBytes
        self.maximumCacheBytes = maximumCacheBytes
        self.minimumAvailableCapacity = minimumAvailableCapacity
        self.streamChunkBytes = streamChunkBytes
        self.maximumAuthorizationManifests = maximumAuthorizationManifests
    }

    var isValid: Bool {
        maximumImageBytes > 0 &&
            maximumCacheBytes >= maximumImageBytes &&
            minimumAvailableCapacity >= 0 &&
            (4_096 ... TchurchStudioLANAssetChunk.byteCount).contains(streamChunkBytes) &&
            maximumAuthorizationManifests > 0
    }
}

struct TchurchStudioLANImageAssetStatus: Equatable {
    enum Phase: String, Equatable {
        case loading
        case ready
        case unavailable
    }

    let cueID: String
    let objectID: String
    let phase: Phase
    let receivedBytes: Int64
    let totalBytes: Int64
    let imageFit: TchurchStudioLANImageFit
    let fileURL: URL?
    let message: String?
}

enum TchurchStudioLANAssetCachePreparation: Equatable {
    case ready(URL)
    case resume(offset: Int64)
}

enum TchurchStudioLANAssetCacheAppendResult: Equatable {
    case partial(nextOffset: Int64)
    case ready(URL)
}

typealias TchurchStudioLANDiskCapacityProvider = @Sendable (URL) -> Int64?

/// Content-addressed image storage used only after a descriptor has crossed
/// the signed LAN-envelope verifier. Persisted authorization manifests are
/// bookkeeping for cleanup and diagnostics; they never authorize cold use.
final class TchurchStudioLANAssetCache: @unchecked Sendable {
    private struct CheckpointPayload: Codable, Equatable {
        static let schemaVersion = 1

        let schemaVersion: Int
        let referenceID: String
        let objectID: String
        let mimeType: String
        let byteSize: Int64
        let receivedBytes: Int64
    }

    private struct CheckedCheckpoint: Codable {
        static let schemaVersion = 1

        let schemaVersion: Int
        let payload: CheckpointPayload
        let checksum: String
    }

    private struct AuthorizationPayload: Codable {
        static let schemaVersion = 1

        let schemaVersion: Int
        let authority: TchurchStudioLANAuthority
        let cueID: String
        let descriptor: TchurchStudioLANImageAssetDescriptor
        let recordedAtMilliseconds: Int64
    }

    private struct CheckedAuthorization: Codable {
        static let schemaVersion = 1

        let schemaVersion: Int
        let payload: AuthorizationPayload
        let checksum: String
    }

    let rootURL: URL

    private let fileManager: FileManager
    private let limits: TchurchStudioLANAssetCacheLimits
    private let diskCapacity: TchurchStudioLANDiskCapacityProvider
    private let objectsURL: URL
    private let stagingURL: URL
    private let authorizationsURL: URL

    init(
        rootURL: URL? = nil,
        fileManager: FileManager = .default,
        limits: TchurchStudioLANAssetCacheLimits = .production,
        diskCapacity: TchurchStudioLANDiskCapacityProvider? = nil
    ) {
        self.fileManager = fileManager
        self.limits = limits
        self.diskCapacity = diskCapacity ?? { Self.systemAvailableCapacity($0) }
        if let rootURL {
            self.rootURL = rootURL
        } else {
            let applicationSupport = fileManager.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first ?? fileManager.temporaryDirectory
            self.rootURL = applicationSupport
                .appendingPathComponent("Tchurch", isDirectory: true)
                .appendingPathComponent("StudioLANAssets", isDirectory: true)
                .appendingPathComponent("v1", isDirectory: true)
        }
        objectsURL = self.rootURL.appendingPathComponent("objects", isDirectory: true)
        stagingURL = self.rootURL.appendingPathComponent("staging", isDirectory: true)
        authorizationsURL = self.rootURL.appendingPathComponent("authorizations", isDirectory: true)
    }

    func prepare(
        descriptor: TchurchStudioLANImageAssetDescriptor,
        authority: TchurchStudioLANAuthority,
        cueID: String,
        protectedObjectIDs: Set<String>,
        recordsAuthorization: Bool = true
    ) throws -> TchurchStudioLANAssetCachePreparation {
        try validate(descriptor)
        guard limits.isValid, !cueID.isEmpty, cueID.utf8.count <= 160 else {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
        try prepareDirectories()
        _ = try safeFiles(in: objectsURL, withExtension: nil)
        _ = try safeFiles(in: stagingURL, withExtension: "part")
        if recordsAuthorization {
            try persistAuthorization(descriptor: descriptor, authority: authority, cueID: cueID)
        }

        let finalURL = try objectURL(for: descriptor)
        let partURL = try partialURL(for: descriptor.objectID)
        let checkpointURL = try self.checkpointURL(for: descriptor.objectID)
        if fileManager.fileExists(atPath: finalURL.path) {
            do {
                try verifyFinalObject(at: finalURL, descriptor: descriptor)
                try protectFile(finalURL, permissions: 0o600)
                try excludeFromBackup(finalURL)
                try removePartialFiles(partURL: partURL, checkpointURL: checkpointURL)
                try synchronizeDirectory(objectsURL)
                try touch(finalURL)
                return .ready(finalURL)
            } catch {
                try? fileManager.removeItem(at: finalURL)
            }
        }

        var offset: Int64 = 0
        if fileManager.fileExists(atPath: partURL.path) || fileManager.fileExists(atPath: checkpointURL.path) {
            do {
                let checkpoint = try loadCheckpoint(at: checkpointURL)
                let values = try safeRegularFileValues(partURL)
                guard checkpoint.referenceID == descriptor.referenceID,
                      checkpoint.objectID == descriptor.objectID,
                      checkpoint.mimeType == descriptor.mimeType,
                      checkpoint.byteSize == descriptor.byteSize,
                      checkpoint.receivedBytes >= 0,
                      checkpoint.receivedBytes < descriptor.byteSize,
                      Int64(values.fileSize ?? -1) == checkpoint.receivedBytes else {
                    throw TchurchStudioLANError.assetCacheCorrupted
                }
                offset = checkpoint.receivedBytes
            } catch {
                try? fileManager.removeItem(at: partURL)
                try? fileManager.removeItem(at: checkpointURL)
                offset = 0
            }
        }

        let requiredBytes = descriptor.byteSize - offset
        try makeCapacity(requiredBytes: requiredBytes, protectedObjectIDs: protectedObjectIDs.union([descriptor.objectID]))
        if offset == 0 {
            guard fileManager.createFile(atPath: partURL.path, contents: Data()) else {
                throw TchurchStudioLANError.assetCacheUnavailable
            }
            try protectFile(partURL, permissions: 0o600)
            try persistCheckpoint(
                .init(
                    schemaVersion: CheckpointPayload.schemaVersion,
                    referenceID: descriptor.referenceID,
                    objectID: descriptor.objectID,
                    mimeType: descriptor.mimeType,
                    byteSize: descriptor.byteSize,
                    receivedBytes: 0
                ),
                to: checkpointURL
            )
        }
        return .resume(offset: offset)
    }

    func append(
        _ chunk: TchurchStudioLANAssetChunk,
        descriptor: TchurchStudioLANImageAssetDescriptor
    ) throws -> TchurchStudioLANAssetCacheAppendResult {
        try validate(descriptor)
        guard chunk.schemaVersion == TchurchStudioLANAssetChunk.schemaVersion,
              chunk.objectID == descriptor.objectID,
              chunk.totalByteSize == descriptor.byteSize,
              !chunk.data.isEmpty,
              chunk.data.count <= TchurchStudioLANAssetChunk.byteCount,
              chunk.offset >= 0,
              chunk.offset < descriptor.byteSize,
              chunk.offset + Int64(chunk.data.count) <= descriptor.byteSize,
              chunk.dataSha256 == "sha256:\(Self.sha256Hex(chunk.data))",
              chunk.isFinal == (chunk.offset + Int64(chunk.data.count) == descriptor.byteSize) else {
            throw TchurchStudioLANError.invalidAssetChunk
        }

        let partURL = try partialURL(for: descriptor.objectID)
        let checkpointURL = try self.checkpointURL(for: descriptor.objectID)
        let checkpoint = try loadCheckpoint(at: checkpointURL)
        let values = try safeRegularFileValues(partURL)
        guard checkpoint.objectID == descriptor.objectID,
              checkpoint.referenceID == descriptor.referenceID,
              checkpoint.mimeType == descriptor.mimeType,
              checkpoint.byteSize == descriptor.byteSize,
              checkpoint.receivedBytes == chunk.offset,
              Int64(values.fileSize ?? -1) == chunk.offset else {
            throw TchurchStudioLANError.assetCacheCorrupted
        }

        do {
            let handle = try FileHandle(forWritingTo: partURL)
            defer { try? handle.close() }
            try handle.seek(toOffset: UInt64(chunk.offset))
            try handle.write(contentsOf: chunk.data)
            try handle.synchronize()
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }

        let nextOffset = chunk.offset + Int64(chunk.data.count)
        if !chunk.isFinal {
            try persistCheckpoint(
                .init(
                    schemaVersion: CheckpointPayload.schemaVersion,
                    referenceID: descriptor.referenceID,
                    objectID: descriptor.objectID,
                    mimeType: descriptor.mimeType,
                    byteSize: descriptor.byteSize,
                    receivedBytes: nextOffset
                ),
                to: checkpointURL
            )
            return .partial(nextOffset: nextOffset)
        }

        guard nextOffset == descriptor.byteSize else {
            throw TchurchStudioLANError.invalidAssetChunk
        }
        let digest = try streamDigest(partURL, maximumBytes: limits.maximumImageBytes)
        guard digest.byteCount == descriptor.byteSize,
              digest.objectID == descriptor.objectID,
              try validMagic(at: partURL, mimeType: descriptor.mimeType) else {
            try? fileManager.removeItem(at: partURL)
            try? fileManager.removeItem(at: checkpointURL)
            throw TchurchStudioLANError.assetCacheCorrupted
        }

        let finalURL = try objectURL(for: descriptor)
        do {
            if fileManager.fileExists(atPath: finalURL.path) {
                do {
                    try verifyFinalObject(at: finalURL, descriptor: descriptor)
                    try protectFile(finalURL, permissions: 0o600)
                    try excludeFromBackup(finalURL)
                    try removePartialFiles(partURL: partURL, checkpointURL: checkpointURL)
                    try synchronizeDirectory(objectsURL)
                    try touch(finalURL)
                    return .ready(finalURL)
                } catch {
                    try? fileManager.removeItem(at: finalURL)
                }
            }
            do {
                try fileManager.moveItem(at: partURL, to: finalURL)
            } catch {
                // A second cache instance may have atomically promoted the
                // same digest after the existence check. Trust it only after
                // a full digest, size, and magic verification.
                guard fileManager.fileExists(atPath: finalURL.path) else { throw error }
                try verifyFinalObject(at: finalURL, descriptor: descriptor)
                try protectFile(finalURL, permissions: 0o600)
                try excludeFromBackup(finalURL)
                try removePartialFiles(partURL: partURL, checkpointURL: checkpointURL)
                try synchronizeDirectory(objectsURL)
                try touch(finalURL)
                return .ready(finalURL)
            }
            try protectFile(finalURL, permissions: 0o600)
            try excludeFromBackup(finalURL)
            try removePartialFiles(partURL: partURL, checkpointURL: checkpointURL)
            try synchronizeDirectory(objectsURL)
            try touch(finalURL)
            return .ready(finalURL)
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func discardPartial(objectID: String) throws {
        let partURL = try partialURL(for: objectID)
        let checkpointURL = try self.checkpointURL(for: objectID)
        do {
            try removePartialFiles(partURL: partURL, checkpointURL: checkpointURL)
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func purgeAll() throws {
        guard fileManager.fileExists(atPath: rootURL.path) else { return }
        do {
            let values = try rootURL.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
                throw TchurchStudioLANError.assetCacheCorrupted
            }
            try fileManager.removeItem(at: rootURL)
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }
}

private extension TchurchStudioLANAssetCache {
    func validate(_ descriptor: TchurchStudioLANImageAssetDescriptor) throws {
        guard descriptor.schemaVersion == TchurchStudioLANImageAssetDescriptor.schemaVersion,
              descriptor.kind == .image,
              Self.validObjectID(descriptor.referenceID),
              Self.validObjectID(descriptor.objectID),
              Self.extensionForMIME(descriptor.mimeType) != nil,
              descriptor.byteSize > 0,
              descriptor.byteSize <= limits.maximumImageBytes else {
            throw TchurchStudioLANError.assetCacheLimitExceeded
        }
    }

    func prepareDirectories() throws {
        guard limits.isValid else { throw TchurchStudioLANError.assetCacheUnavailable }
        do {
            for url in [rootURL, objectsURL, stagingURL, authorizationsURL] {
                if fileManager.fileExists(atPath: url.path) {
                    let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                    guard values.isDirectory == true, values.isSymbolicLink != true else {
                        throw TchurchStudioLANError.assetCacheCorrupted
                    }
                } else {
                    try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
                }
                try protectFile(url, permissions: 0o700)
                try excludeFromBackup(url)
            }
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func objectURL(for descriptor: TchurchStudioLANImageAssetDescriptor) throws -> URL {
        guard let fileExtension = Self.extensionForMIME(descriptor.mimeType) else {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
        return objectsURL.appendingPathComponent(
            "\(try digestComponent(descriptor.objectID)).\(fileExtension)",
            isDirectory: false
        )
    }

    func partialURL(for objectID: String) throws -> URL {
        stagingURL.appendingPathComponent("\(try digestComponent(objectID)).part", isDirectory: false)
    }

    func checkpointURL(for objectID: String) throws -> URL {
        stagingURL.appendingPathComponent("\(try digestComponent(objectID)).checkpoint", isDirectory: false)
    }

    func digestComponent(_ objectID: String) throws -> String {
        guard Self.validObjectID(objectID) else { throw TchurchStudioLANError.assetCacheUnavailable }
        return String(objectID.dropFirst("sha256:".count))
    }

    private func persistCheckpoint(_ payload: CheckpointPayload, to url: URL) throws {
        let payloadData = try canonicalData(payload)
        let envelope = CheckedCheckpoint(
            schemaVersion: CheckedCheckpoint.schemaVersion,
            payload: payload,
            checksum: "sha256:\(Self.sha256Hex(payloadData))"
        )
        try persist(envelope, to: url, permissions: 0o600)
    }

    private func loadCheckpoint(at url: URL) throws -> CheckpointPayload {
        let values = try safeRegularFileValues(url)
        guard let size = values.fileSize, size > 0, size <= 16 * 1_024 else {
            throw TchurchStudioLANError.assetCacheCorrupted
        }
        let data: Data
        do { data = try Data(contentsOf: url) } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
        guard let envelope = try? TchurchStudioLANCoding.decoder().decode(CheckedCheckpoint.self, from: data),
              envelope.schemaVersion == CheckedCheckpoint.schemaVersion,
              envelope.payload.schemaVersion == CheckpointPayload.schemaVersion,
              envelope.checksum == "sha256:\(Self.sha256Hex(try canonicalData(envelope.payload)))" else {
            throw TchurchStudioLANError.assetCacheCorrupted
        }
        return envelope.payload
    }

    func persistAuthorization(
        descriptor: TchurchStudioLANImageAssetDescriptor,
        authority: TchurchStudioLANAuthority,
        cueID: String
    ) throws {
        let payload = AuthorizationPayload(
            schemaVersion: AuthorizationPayload.schemaVersion,
            authority: authority,
            cueID: cueID,
            descriptor: descriptor,
            recordedAtMilliseconds: TchurchStudioLANTime.nowMilliseconds()
        )
        let payloadData = try canonicalData(payload)
        let checked = CheckedAuthorization(
            schemaVersion: CheckedAuthorization.schemaVersion,
            payload: payload,
            checksum: "sha256:\(Self.sha256Hex(payloadData))"
        )
        let material = [
            authority.runID.uuidString.lowercased(),
            String(authority.authorityEpoch),
            authority.packageID,
            cueID,
            descriptor.objectID,
        ].joined(separator: "\u{001F}")
        let name = Self.sha256Hex(Data(material.utf8))
        try persist(
            checked,
            to: authorizationsURL.appendingPathComponent("\(name).authorization", isDirectory: false),
            permissions: 0o600
        )
        try pruneAuthorizationManifests()
    }

    func pruneAuthorizationManifests() throws {
        let files = try safeFiles(in: authorizationsURL, withExtension: "authorization")
        guard files.count > limits.maximumAuthorizationManifests else { return }
        let sorted = files.sorted { left, right in
            let leftDate = (try? left.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
                ?? .distantPast
            let rightDate = (try? right.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
                ?? .distantPast
            if leftDate == rightDate { return left.lastPathComponent < right.lastPathComponent }
            return leftDate < rightDate
        }
        for url in sorted.prefix(files.count - limits.maximumAuthorizationManifests) {
            try fileManager.removeItem(at: url)
        }
    }

    func makeCapacity(requiredBytes: Int64, protectedObjectIDs: Set<String>) throws {
        guard requiredBytes >= 0, requiredBytes <= limits.maximumImageBytes else {
            throw TchurchStudioLANError.assetCacheLimitExceeded
        }
        guard let available = diskCapacity(rootURL),
              available >= limits.minimumAvailableCapacity,
              requiredBytes <= available - limits.minimumAvailableCapacity else {
            throw TchurchStudioLANError.insufficientDiskSpace
        }

        var files = try safeFiles(in: objectsURL, withExtension: nil)
        var total = try files.reduce(Int64(0)) { sum, url in
            let size = Int64(try safeRegularFileValues(url).fileSize ?? 0)
            let (next, overflow) = sum.addingReportingOverflow(size)
            guard !overflow else { throw TchurchStudioLANError.assetCacheLimitExceeded }
            return next
        }
        let stagingBytes = try safeFiles(in: stagingURL, withExtension: "part").reduce(Int64(0)) { sum, url in
            let size = Int64(try safeRegularFileValues(url).fileSize ?? 0)
            let (next, overflow) = sum.addingReportingOverflow(size)
            guard !overflow else { throw TchurchStudioLANError.assetCacheLimitExceeded }
            return next
        }
        let (totalWithStaging, stagingOverflow) = total.addingReportingOverflow(stagingBytes)
        guard !stagingOverflow else { throw TchurchStudioLANError.assetCacheLimitExceeded }
        total = totalWithStaging
        let (requiredTotal, requiredOverflow) = total.addingReportingOverflow(requiredBytes)
        guard !requiredOverflow else { throw TchurchStudioLANError.assetCacheLimitExceeded }
        guard requiredTotal > limits.maximumCacheBytes else { return }

        files.sort { left, right in
            let leftDate = (try? left.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
                ?? .distantPast
            let rightDate = (try? right.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
                ?? .distantPast
            if leftDate == rightDate { return left.lastPathComponent < right.lastPathComponent }
            return leftDate < rightDate
        }
        let protectedDigests = Set(protectedObjectIDs.compactMap { try? digestComponent($0) })
        for url in files {
            let digest = String(url.deletingPathExtension().lastPathComponent.prefix(64))
            guard !protectedDigests.contains(digest) else { continue }
            let size = Int64(try safeRegularFileValues(url).fileSize ?? 0)
            try fileManager.removeItem(at: url)
            total -= size
            let (remainingRequiredTotal, overflow) = total.addingReportingOverflow(requiredBytes)
            guard !overflow else { throw TchurchStudioLANError.assetCacheLimitExceeded }
            if remainingRequiredTotal <= limits.maximumCacheBytes { return }
        }
        throw TchurchStudioLANError.assetCacheLimitExceeded
    }

    func verifyFinalObject(
        at url: URL,
        descriptor: TchurchStudioLANImageAssetDescriptor
    ) throws {
        let values = try safeRegularFileValues(url)
        guard Int64(values.fileSize ?? -1) == descriptor.byteSize else {
            throw TchurchStudioLANError.assetCacheCorrupted
        }
        let digest = try streamDigest(url, maximumBytes: limits.maximumImageBytes)
        guard digest.objectID == descriptor.objectID,
              digest.byteCount == descriptor.byteSize,
              try validMagic(at: url, mimeType: descriptor.mimeType) else {
            throw TchurchStudioLANError.assetCacheCorrupted
        }
    }

    func streamDigest(_ url: URL, maximumBytes: Int64) throws -> (objectID: String, byteCount: Int64) {
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: url) } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
        defer { try? handle.close() }
        var hasher = SHA256()
        var count: Int64 = 0
        do {
            while let data = try handle.read(upToCount: limits.streamChunkBytes), !data.isEmpty {
                let (next, overflow) = count.addingReportingOverflow(Int64(data.count))
                guard !overflow, next <= maximumBytes else {
                    throw TchurchStudioLANError.assetCacheLimitExceeded
                }
                count = next
                hasher.update(data: data)
            }
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
        let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        return ("sha256:\(hex)", count)
    }

    func validMagic(at url: URL, mimeType: String) throws -> Bool {
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: url) } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
        defer { try? handle.close() }
        let data: Data
        do { data = try handle.read(upToCount: 64) ?? Data() } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
        let bytes = [UInt8](data)
        switch mimeType {
        case "image/png":
            return bytes.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        case "image/jpeg":
            return bytes.starts(with: [0xFF, 0xD8, 0xFF])
        case "image/gif":
            return data.starts(with: Data("GIF87a".utf8)) || data.starts(with: Data("GIF89a".utf8))
        case "image/webp":
            return bytes.count >= 12 && Data(bytes[0 ..< 4]) == Data("RIFF".utf8) &&
                Data(bytes[8 ..< 12]) == Data("WEBP".utf8)
        case "image/avif":
            guard bytes.count >= 16, Data(bytes[4 ..< 8]) == Data("ftyp".utf8) else { return false }
            return data.range(of: Data("avif".utf8)) != nil || data.range(of: Data("avis".utf8)) != nil
        default:
            return false
        }
    }

    func safeRegularFileValues(_ url: URL) throws -> URLResourceValues {
        do {
            let values = try url.resourceValues(forKeys: [
                .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey,
            ])
            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o777
            guard values.isRegularFile == true,
                  values.isSymbolicLink != true,
                  permissions & 0o777 == 0o600 else {
                throw TchurchStudioLANError.assetCacheCorrupted
            }
            return values
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func safeFiles(in directory: URL, withExtension pathExtension: String?) throws -> [URL] {
        do {
            let entries = try fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [
                    .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey,
                    .contentModificationDateKey,
                ],
                options: []
            )
            var accepted: [URL] = []
            for url in entries {
                let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                let attributes = try fileManager.attributesOfItem(atPath: url.path)
                let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o777
                guard values.isRegularFile == true,
                      values.isSymbolicLink != true,
                      permissions & 0o777 == 0o600 else {
                    throw TchurchStudioLANError.assetCacheCorrupted
                }
                if pathExtension == nil || url.pathExtension == pathExtension {
                    accepted.append(url)
                    continue
                }
                let isExpectedCheckpoint = directory.standardizedFileURL == stagingURL.standardizedFileURL &&
                    pathExtension == "part" && url.pathExtension == "checkpoint"
                guard isExpectedCheckpoint else {
                    throw TchurchStudioLANError.assetCacheCorrupted
                }
            }
            return accepted
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func removePartialFiles(partURL: URL, checkpointURL: URL) throws {
        if fileManager.fileExists(atPath: partURL.path) { try fileManager.removeItem(at: partURL) }
        if fileManager.fileExists(atPath: checkpointURL.path) { try fileManager.removeItem(at: checkpointURL) }
    }

    func persist<Value: Encodable>(_ value: Value, to url: URL, permissions: Int) throws {
        do {
            let data = try TchurchStudioLANCoding.encoder().encode(value)
            try data.write(to: url, options: .atomic)
            try protectFile(url, permissions: permissions)
            try excludeFromBackup(url)
            let handle = try FileHandle(forWritingTo: url)
            try handle.synchronize()
            try handle.close()
            try synchronizeDirectory(url.deletingLastPathComponent())
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func canonicalData<Value: Encodable>(_ value: Value) throws -> Data {
        do { return try TchurchStudioLANCoding.encoder().encode(value) }
        catch { throw TchurchStudioLANError.assetCacheUnavailable }
    }

    func protectFile(_ url: URL, permissions: Int) throws {
        do {
            try fileManager.setAttributes([
                .posixPermissions: permissions,
                .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
            ], ofItemAtPath: url.path)
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func excludeFromBackup(_ url: URL) throws {
        do {
            var mutableURL = url
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try mutableURL.setResourceValues(values)
        } catch {
            throw TchurchStudioLANError.assetCacheUnavailable
        }
    }

    func touch(_ url: URL) throws {
        do { try fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path) }
        catch { throw TchurchStudioLANError.assetCacheUnavailable }
    }

    func synchronizeDirectory(_ url: URL) throws {
        let descriptor = open(url.path, O_RDONLY)
        guard descriptor >= 0 else { throw TchurchStudioLANError.assetCacheUnavailable }
        defer { _ = close(descriptor) }
        guard fsync(descriptor) == 0 else { throw TchurchStudioLANError.assetCacheUnavailable }
    }

    static func validObjectID(_ value: String) -> Bool {
        guard value.hasPrefix("sha256:") else { return false }
        let digest = value.dropFirst("sha256:".count)
        return digest.utf8.count == 64 && digest.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
        }
    }

    static func extensionForMIME(_ mimeType: String) -> String? {
        switch mimeType {
        case "image/png": "png"
        case "image/jpeg": "jpg"
        case "image/webp": "webp"
        case "image/avif": "avif"
        case "image/gif": "gif"
        default: nil
        }
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func systemAvailableCapacity(_ url: URL) -> Int64? {
        if let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
           let capacity = values.volumeAvailableCapacityForImportantUsage {
            return capacity
        }
        if let attributes = try? FileManager.default.attributesOfFileSystem(forPath: url.path),
           let free = attributes[.systemFreeSize] as? NSNumber {
            return free.int64Value
        }
        return nil
    }
}
