use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;

/// An enum of error handlers for the REST API server.
#[derive(Debug)]
pub(crate) struct RestError(pub(crate) String);

impl IntoResponse for RestError {
    fn into_response(self) -> Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Something went wrong: {}", self.0),
        )
            .into_response()
    }
}

impl From<anyhow::Error> for RestError {
    fn from(err: anyhow::Error) -> Self {
        Self(err.to_string())
    }
}

impl From<RestError> for String {
    fn from(val: RestError) -> Self {
        val.0
    }
}
