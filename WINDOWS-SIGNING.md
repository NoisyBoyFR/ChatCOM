# Windows code-signing setup

ChatCOM uses Microsoft Artifact Signing (formerly Trusted Signing) for public
Windows Authenticode signatures. The workflow is intentionally manual,
protected by the `windows-code-signing` GitHub environment, and incapable of
creating a tag or GitHub Release.

## External prerequisites

These steps require the repository owner and cannot be completed by source
code alone:

1. Create or select an Azure subscription and register the
   `Microsoft.CodeSigning` resource provider.
2. Create an Artifact Signing account.
3. Complete identity validation in the Azure portal.
4. Create a `PublicTrust` certificate profile.
5. Create a Microsoft Entra application and service principal.
6. Add a federated credential with this exact subject:

   ```text
   repo:NoisyBoyFR/ChatCOM:environment:windows-code-signing
   ```

7. Assign the service principal the **Artifact Signing Certificate Profile
   Signer** role on the certificate profile, signing account, or containing
   resource group.

Never send a private key, client secret, certificate password, access token,
or Azure credential through ChatCOM, an issue, a pull request, or a log.

## Protected GitHub environment

Create the `windows-code-signing` environment, restrict deployment to `main`,
and require a reviewer when the repository plan supports it. Define these
environment variables directly in GitHub settings:

| Variable | Purpose |
| --- | --- |
| `AZURE_TENANT_ID` | Microsoft Entra tenant ID |
| `AZURE_CLIENT_ID` | Federated application/client ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription containing Artifact Signing |
| `ARTIFACT_SIGNING_ENDPOINT` | Regional Artifact Signing endpoint |
| `ARTIFACT_SIGNING_ACCOUNT_NAME` | Artifact Signing account name |
| `ARTIFACT_SIGNING_CERTIFICATE_PROFILE` | Public Trust certificate profile |
| `ARTIFACT_SIGNING_PUBLISHER_SUBJECT` | Exact Authenticode certificate subject |

OIDC is used instead of a client secret. Do not create repository secrets for
certificate material.

## Manual validation run

From the GitHub Actions page, select **Sign Windows RC**, choose `main`, enter
`SIGN_RC4`, and run the workflow. It will:

1. validate the protected context and required variables;
2. verify the source and package the Windows application;
3. authenticate to Azure with OIDC;
4. sign packaged PE binaries with RSA/SHA-256 and an RFC 3161 timestamp;
5. build the Squirrel package from the signed application;
6. sign and independently verify the final Setup;
7. calculate final hashes and emit a signed build manifest;
8. upload a temporary `-signed` validation artifact.

The workflow fails closed when configuration, signature, publisher, timestamp,
package, or checksum validation fails. A successful validation artifact still
does not authorize or automatically create a tag, Release, public update feed,
or npm publication.
