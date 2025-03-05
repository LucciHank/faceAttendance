// Xử lý lưu cài đặt
document.querySelector('#saveSettingsBtn').addEventListener('click', async function() {
    try {
        const settings = {
            work_start_time: document.querySelector('#workStartTime').value,
            work_end_time: document.querySelector('#workEndTime').value,
            late_threshold: parseInt(document.querySelector('#lateThreshold').value)
        };

        const response = await fetch('/admin/settings/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();

        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Đã lưu cài đặt',
                confirmButtonColor: 'var(--accent-primary)'
            });
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'Lỗi',
            text: error.message || 'Không thể lưu cài đặt',
            confirmButtonColor: 'var(--accent-primary)'
        });
    }
}); 