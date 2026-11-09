using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

public static class PocClientCore
{
    public static bool IsPrivateIPv4(string address)
    {
        IPAddress parsed;
        if (!IPAddress.TryParse(address, out parsed) || parsed.AddressFamily != AddressFamily.InterNetwork) return false;
        byte[] b = parsed.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
    }
    private static byte[] ReadExactly(Stream stream, int length)
    {
        byte[] buffer = new byte[length]; int offset = 0;
        while (offset < length) { int n = stream.Read(buffer, offset, length - offset); if (n <= 0) throw new EndOfStreamException(); offset += n; }
        return buffer;
    }
    public static byte[] ReadFrame(Stream stream, int maximum)
    {
        byte[] h = ReadExactly(stream, 4);
        uint size = ((uint)h[0] << 24) | ((uint)h[1] << 16) | ((uint)h[2] << 8) | h[3];
        if (size == 0 || size > maximum) throw new InvalidDataException("invalid_frame");
        return ReadExactly(stream, (int)size);
    }
    public static void WriteFrame(Stream stream, byte[] bytes, int maximum)
    {
        if (bytes == null || bytes.Length == 0 || bytes.Length > maximum) throw new InvalidDataException("invalid_frame");
        int size = bytes.Length;
        byte[] header = new byte[] { (byte)(size >> 24), (byte)(size >> 16), (byte)(size >> 8), (byte)size };
        stream.Write(header, 0, 4); stream.Write(bytes, 0, size); stream.Flush();
    }
    public static bool CertificateMatches(X509Certificate certificate, string expectedSha256)
    {
        if (certificate == null || expectedSha256 == null || expectedSha256.Length != 64) return false;
        try {
            using (X509Certificate2 cert = new X509Certificate2(certificate)) {
                if (DateTime.UtcNow < cert.NotBefore.ToUniversalTime() || DateTime.UtcNow > cert.NotAfter.ToUniversalTime()) return false;
                byte[] hash; using (SHA256 sha = SHA256.Create()) { hash = sha.ComputeHash(cert.RawData); }
                int difference = 0;
                for (int i = 0; i < hash.Length; i++) difference |= hash[i] ^ Convert.ToByte(expectedSha256.Substring(i * 2, 2), 16);
                return difference == 0;
            }
        } catch { return false; }
    }
    public static string Send(string address, int port, string sha256, string request)
    {
        if (!IsPrivateIPv4(address) || port < 1 || port > 65535) throw new ArgumentException("invalid_endpoint");
        byte[] body = new UTF8Encoding(false, true).GetBytes(request);
        if (body.Length > 65536) throw new InvalidDataException("request_too_large");
        using (TcpClient tcp = new TcpClient(AddressFamily.InterNetwork)) {
            IAsyncResult connect = tcp.BeginConnect(address, port, null, null);
            try { if (!connect.AsyncWaitHandle.WaitOne(10000)) throw new TimeoutException("connect_timeout"); tcp.EndConnect(connect); }
            finally { connect.AsyncWaitHandle.Close(); }
            tcp.ReceiveTimeout = 60000; tcp.SendTimeout = 15000;
            using (SslStream ssl = new SslStream(tcp.GetStream(), false, delegate(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors) { return CertificateMatches(cert, sha256); })) {
                ssl.ReadTimeout = 60000; ssl.WriteTimeout = 15000;
                IAsyncResult auth = ssl.BeginAuthenticateAsClient("PiRemoteGuiWorker", null, SslProtocols.Tls12, false, null, null);
                try { if (!auth.AsyncWaitHandle.WaitOne(10000)) throw new TimeoutException("tls_timeout"); ssl.EndAuthenticateAsClient(auth); }
                finally { auth.AsyncWaitHandle.Close(); }
                WriteFrame(ssl, body, 65536);
                return new UTF8Encoding(false, true).GetString(ReadFrame(ssl, 8388608));
            }
        }
    }
}
