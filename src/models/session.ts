export default interface Session {
    orgnizationId: string;
    userId: string;
    sessionId: string;
    refreshToken: string;
    instanceUrl: string;
    loginUrl: string;
    projectName: string;
    lastUpdatedTime: string;
}