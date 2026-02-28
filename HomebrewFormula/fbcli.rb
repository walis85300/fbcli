# Homebrew formula for fbcli.
#
# HOST THIS FILE in a separate GitHub repository named "homebrew-tap":
#   https://github.com/OWNER/homebrew-tap/blob/main/Formula/fbcli.rb
#
# After each release, update `version` and the four `sha256` values.
# The correct sha256 hashes are printed in the "Print SHA256 checksums"
# step of the release workflow on GitHub Actions.
#
# Users install with:
#   brew tap OWNER/tap
#   brew install fbcli

class Fbcli < Formula
  desc "Read-only Facebook Marketing API CLI for humans and agents"
  homepage "https://github.com/OWNER/fbcli"
  version "0.1.0"

  # Binaries are self-contained (compiled with `bun build --compile`).
  # No runtime dependencies required.

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/OWNER/fbcli/releases/download/v#{version}/fbcli-darwin-arm64"
      sha256 "REPLACE_WITH_SHA256_OF_fbcli-darwin-arm64"
    else
      url "https://github.com/OWNER/fbcli/releases/download/v#{version}/fbcli-darwin-x64"
      sha256 "REPLACE_WITH_SHA256_OF_fbcli-darwin-x64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/OWNER/fbcli/releases/download/v#{version}/fbcli-linux-arm64"
      sha256 "REPLACE_WITH_SHA256_OF_fbcli-linux-arm64"
    else
      url "https://github.com/OWNER/fbcli/releases/download/v#{version}/fbcli-linux-x64"
      sha256 "REPLACE_WITH_SHA256_OF_fbcli-linux-x64"
    end
  end

  def install
    if OS.mac?
      arch = Hardware::CPU.arm? ? "arm64" : "x64"
      bin.install "fbcli-darwin-#{arch}" => "fbcli"
    else
      arch = Hardware::CPU.arm? ? "arm64" : "x64"
      bin.install "fbcli-linux-#{arch}" => "fbcli"
    end
  end

  test do
    assert_match "Facebook", shell_output("#{bin}/fbcli --help")
  end
end
