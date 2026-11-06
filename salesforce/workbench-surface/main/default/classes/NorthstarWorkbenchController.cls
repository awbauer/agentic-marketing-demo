/**
 * Relays the Northstar Lightning surface to the Marketing Workbench Worker.
 *
 * The caller presents the Cloudflare Access token it received at Login, so the Worker sees the
 * same person as the browser app. Only the operations named here can be reached, and the token is
 * neither stored nor logged. Keep this class free of debug statements that touch its arguments.
 */
public with sharing class NorthstarWorkbenchController {
    @TestVisible
    private static final String WORKER_URL = 'https://marketing.becurious.one';
    private static final Integer SHORT_TIMEOUT_MS = 30000;
    private static final Integer WRITE_TIMEOUT_MS = 120000;
    private static final Map<String, List<String>> OPERATIONS = new Map<String, List<String>>{
        'bootstrap' => new List<String>{ 'GET', '/api/surface/bootstrap' },
        'messages' => new List<String>{ 'GET', '/agent/surface/messages' },
        'progress' => new List<String>{ 'GET', '/agent/surface/turn' },
        'startTurn' => new List<String>{ 'POST', '/agent/surface/turn' },
        'stopTurn' => new List<String>{ 'POST', '/agent/surface/stop' },
        'clearChat' => new List<String>{ 'POST', '/agent/surface/clear' },
        'history' => new List<String>{ 'GET', '/agent/turns' },
        'operations' => new List<String>{ 'GET', '/agent/operations' },
        'salesforceStatus' => new List<String>{ 'GET', '/agent/salesforce/status' },
        'salesforceConnect' => new List<String>{ 'POST', '/agent/salesforce/connect' },
        'salesforceDisconnect' => new List<String>{ 'POST', '/agent/salesforce/disconnect' },
        'confirmWrite' => new List<String>{ 'POST', '/agent/confirmations/execute' },
        'declineWrite' => new List<String>{ 'POST', '/agent/confirmations/deny' }
    };
    private static final Set<String> WRITES = new Set<String>{ 'confirmWrite' };

    public class Result {
        @AuraEnabled
        public Integer status;
        @AuraEnabled
        public String body;
    }

    @AuraEnabled
    public static Result call(String operation, String accessToken, String body) {
        List<String> route = OPERATIONS.get(operation);
        if (route == null) {
            throw new AuraHandledException('Unknown workbench operation.');
        }
        if (String.isBlank(accessToken)) {
            return unauthenticated();
        }
        HttpRequest request = new HttpRequest();
        request.setEndpoint(WORKER_URL + route[1]);
        request.setMethod(route[0]);
        request.setHeader('cf-access-token', accessToken);
        request.setTimeout(WRITES.contains(operation) ? WRITE_TIMEOUT_MS : SHORT_TIMEOUT_MS);
        if (route[0] == 'POST') {
            request.setHeader('Content-Type', 'application/json');
            request.setBody(String.isBlank(body) ? '{}' : body);
        }
        try {
            HttpResponse response = new Http().send(request);
            // Access answers a missing or expired token with a redirect to its login page.
            Integer status = response.getStatusCode();
            if (status >= 300 && status < 400) {
                return unauthenticated();
            }
            Result result = new Result();
            result.status = status;
            result.body = response.getBody();
            return result;
        } catch (CalloutException failure) {
            throw new AuraHandledException('The workbench could not be reached. Try again.');
        }
    }

    private static Result unauthenticated() {
        Result result = new Result();
        result.status = 401;
        result.body = '{"error":{"code":"UNAUTHENTICATED","message":"Log in to continue."}}';
        return result;
    }
}
