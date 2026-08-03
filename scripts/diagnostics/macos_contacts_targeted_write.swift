#!/usr/bin/env swift

import Contacts
import Darwin
import Foundation

private struct ProbeFailure: Error {
    let message: String
}

private func errorSummary(_ error: Error) -> String {
    if let failure = error as? ProbeFailure {
        return failure.message
    }
    let nsError = error as NSError
    return "domain=\(nsError.domain) code=\(nsError.code) description=\(nsError.localizedDescription)"
}

private func cardDAVType(_ container: CNContainer) -> Bool {
    container.type == .cardDAV
}

private func probeContacts(
    in container: CNContainer,
    store: CNContactStore,
    givenName: String,
    familyName: String
) throws -> [CNContact] {
    let predicate = CNContact.predicateForContactsInContainer(
        withIdentifier: container.identifier
    )
    let keys = [
        CNContactIdentifierKey,
        CNContactGivenNameKey,
        CNContactFamilyNameKey,
    ] as [CNKeyDescriptor]
    return try store.unifiedContacts(matching: predicate, keysToFetch: keys).filter {
        $0.givenName == givenName && $0.familyName == familyName
    }
}

private func locateProbe(
    containers: [CNContainer],
    store: CNContactStore,
    givenName: String,
    familyName: String
) throws -> [(CNContainer, CNContact)] {
    var matches: [(CNContainer, CNContact)] = []
    var seenIdentifiers = Set<String>()
    for container in containers {
        for contact in try probeContacts(
            in: container,
            store: store,
            givenName: givenName,
            familyName: familyName
        ) {
            if seenIdentifiers.insert(contact.identifier).inserted {
                matches.append((container, contact))
            }
        }
    }
    return matches
}

private func deleteProbe(
    containers: [CNContainer],
    store: CNContactStore,
    givenName: String,
    familyName: String
) throws -> Int {
    let matches = try locateProbe(
        containers: containers,
        store: store,
        givenName: givenName,
        familyName: familyName
    )
    guard !matches.isEmpty else { return 0 }

    let request = CNSaveRequest()
    for (_, contact) in matches {
        guard let mutable = contact.mutableCopy() as? CNMutableContact else {
            throw ProbeFailure(message: "could not prepare the disposable contact for deletion")
        }
        request.delete(mutable)
    }
    try store.execute(request)
    return matches.count
}

private func runProbe() throws {
    let authorization = CNContactStore.authorizationStatus(for: .contacts)
    guard authorization == .authorized else {
        throw ProbeFailure(
            message: "Contacts access is not authorized (status=\(authorization.rawValue))"
        )
    }

    let store = CNContactStore()
    let containers = try store.containers(matching: nil)
    let houseVoContainers = containers.filter {
        cardDAVType($0) && $0.name.caseInsensitiveCompare("housevo") == .orderedSame
    }
    guard houseVoContainers.count == 1, let houseVo = houseVoContainers.first else {
        throw ProbeFailure(
            message: "expected exactly one HouseVo CardDAV container; found \(houseVoContainers.count)"
        )
    }

    let marker = UUID().uuidString.lowercased()
    let givenName = "OMS HouseVo"
    let familyName = "Targeted Write Probe \(marker)"
    let manualCleanupName = "\(givenName) \(familyName)"
    let contact = CNMutableContact()
    contact.givenName = givenName
    contact.familyName = familyName

    let formatter = ISO8601DateFormatter()
    print("START_UTC=\(formatter.string(from: Date()))")
    print("TARGET_ACCOUNT=\(houseVo.name)")
    print("PROBE_NAME=\(manualCleanupName)")

    var created = false
    do {
        let addRequest = CNSaveRequest()
        addRequest.add(contact, toContainerWithIdentifier: houseVo.identifier)
        try store.execute(addRequest)
        created = true
        print("CREATE_OK=true")

        let locations = try locateProbe(
            containers: containers,
            store: store,
            givenName: givenName,
            familyName: familyName
        )
        guard locations.count == 1 else {
            throw ProbeFailure(
                message: "expected one stored probe contact; found \(locations.count)"
            )
        }
        guard locations[0].0.identifier == houseVo.identifier else {
            throw ProbeFailure(
                message: "Contacts stored the probe in \(locations[0].0.name), not HouseVo"
            )
        }
        print("DESTINATION_OK=HouseVo")
        print("SYNC_WAIT_SECONDS=20")
        Thread.sleep(forTimeInterval: 20)

        let deleted = try deleteProbe(
            containers: containers,
            store: store,
            givenName: givenName,
            familyName: familyName
        )
        guard deleted == 1 else {
            throw ProbeFailure(message: "expected to delete one probe contact; deleted \(deleted)")
        }
        let remaining = try locateProbe(
            containers: containers,
            store: store,
            givenName: givenName,
            familyName: familyName
        )
        guard remaining.isEmpty else {
            throw ProbeFailure(message: "the probe contact remains after deletion")
        }
        created = false
        print("DELETE_OK=true")
        print("CLEANUP_SYNC_WAIT_SECONDS=10")
        Thread.sleep(forTimeInterval: 10)
        print("END_UTC=\(formatter.string(from: Date()))")
        print("RESULT=PASS")
    } catch {
        if created {
            do {
                let deleted = try deleteProbe(
                    containers: containers,
                    store: store,
                    givenName: givenName,
                    familyName: familyName
                )
                let remaining = try locateProbe(
                    containers: containers,
                    store: store,
                    givenName: givenName,
                    familyName: familyName
                )
                print("CLEANUP_RETRY_DELETED=\(deleted)")
                print("CLEANUP_RETRY_OK=\(remaining.isEmpty)")
                if !remaining.isEmpty {
                    print("MANUAL_CLEANUP_REQUIRED=\(manualCleanupName)")
                }
            } catch {
                print("CLEANUP_RETRY_ERROR=\(errorSummary(error))")
                print("MANUAL_CLEANUP_REQUIRED=\(manualCleanupName)")
            }
        }
        throw error
    }
}

do {
    try runProbe()
} catch {
    fputs("RESULT=FAIL \(errorSummary(error))\n", stderr)
    exit(1)
}
